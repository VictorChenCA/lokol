#!/usr/bin/env python
"""Teacher generation for Lokol Health (SPEC §3).

Teachers via River: deepseek-ai/DeepSeek-V4.1-Flash (primary) and nvidia/Kimi-K2.6-NVFP4
(secondary).  Each call asks for 5 examples as a JSON array; a thread pool runs calls in
parallel; results are appended to data/synth/raw.jsonl as they complete (resumable: finished
job ids are skipped on restart).

Usage:
  set -a; . ./.env; set +a
  .venv/bin/python pipeline/synth.py --pilot 40 --print 10
  .venv/bin/python pipeline/synth.py --target 3600 --workers 24

Each raw row:
  {"id","job","task","lang","flags","guideline_mode","chunk_id","section","page","presentation",
   "teacher","user","assistant","usage"}
`user` is the complete user turn (flags line, guideline line, nurse message) and `assistant`
is the complete assistant turn in the protocol format.
"""
from __future__ import annotations

import argparse
import json
import os
import random
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CHUNKS = ROOT / "corpus/stm_children_chunks.jsonl"
SECTIONS = ROOT / "corpus/sections.json"
STYLE = ROOT / "pipeline/style_guide.md"
RAW_OUT = ROOT / "data/synth/raw.jsonl"
FAIL_OUT = ROOT / "data/synth/failures.jsonl"

TEACHER_PRIMARY = "deepseek-ai/DeepSeek-V4.1-Flash"
TEACHER_SECONDARY = "nvidia/Kimi-K2.6-NVFP4"
PER_CALL = 5

TASK_MIX = {"guidance": 0.40, "referral": 0.20, "note": 0.20, "followup": 0.10, "abstain": 0.10}
LANG_MIX = {"pis": 0.45, "en": 0.40, "mix": 0.15}

# presentation id -> (section title exactly as in corpus/sections.json, hint for the teacher, held_out)
PRESENTATIONS = [
    ("fever_2d", "FEVER", "fever for 1-3 days, irritable, eating less, no danger signs", False),
    ("fever_7d", "FEVER", "fever for more than 7 days, think of abscess, typhoid, TB, rheumatic fever", False),
    ("malaria_rdt_pos", "MALARIA", "fever, RDT positive, child alert and drinking (uncomplicated)", False),
    ("malaria_severe", "MALARIA", "fever with RDT positive plus convulsion, lethargy, pallor or jaundice (complicated)", False),
    ("malaria_no_test", "MALARIA", "fever, no RDT or microscopy available at the clinic", False),
    ("malaria_no_act", "MALARIA", "RDT positive but no artemether-lumefantrine in stock; second line", False),
    ("cough_fast_breathing", "PNEUMONIA", "cough with fast breathing, no chest indrawing, feeding ok (mild)", False),
    ("pneumonia_severe", "PNEUMONIA", "cough with chest indrawing, grunting, nasal flaring or not feeding (severe)", False),
    ("young_infant_cough", "PNEUMONIA", "baby under 2 months with cough, fever or fast breathing", False),
    ("diarrhoea_no_dehyd", "DIARRHOEA", "watery diarrhoea, alert, drinking well, normal eyes", False),
    ("diarrhoea_some_dehyd", "DIARRHOEA", "watery diarrhoea with sunken eyes, thirsty, restless", False),
    ("diarrhoea_severe", "DIARRHOEA", "diarrhoea with floppy child, drinks poorly, very sunken eyes", False),
    ("dysentery", "DIARRHOEA WITH BLOOD - DYSENTERY", "diarrhoea with blood in stool", False),
    ("persistent_diarrhoea", "PERSISTENT DIARRHOEA - LASTING MORE THAN 14 DAYS", "diarrhoea lasting more than 2 weeks, losing weight", True),
    ("malnutrition_sam", "MALNUTRITION", "visible severe wasting, MUAC under 115 mm, or oedema of both feet", False),
    ("malnutrition_moderate", "MALNUTRITION", "low weight for age, poor appetite, no oedema, no complications", False),
    ("anaemia_pallor", "ANAEMIA", "pale palms and conjunctiva, tired, sometimes with malaria or worms", True),
    ("asthma_wheeze", "ASTHMA", "recurrent wheeze and cough, salbutamol by puffer and spacer", False),
    ("asthma_severe", "ASTHMA", "wheeze with difficulty talking, severe work of breathing or silent chest", False),
    ("burns_scald", "BURNS AND SCALDS", "scald from hot water or cooking pot on arm or leg, small area", True),
    ("burns_face", "BURNS AND SCALDS", "burn to the face, neck, hands or more than 10% of body", False),
    ("convulsion_febrile", "CONVULSIONS", "short convulsion at home with fever, now awake", False),
    ("convulsion_ongoing", "CONVULSIONS", "child still fitting at the clinic or repeated fits", False),
    ("meningitis", "MENINGITIS", "fever with stiff neck, bulging fontanelle, drowsy or vomiting", False),
    ("measles", "MEASLES", "fever with rash, red eyes, runny nose and cough; check vitamin A and complications", False),
    ("otitis", "OTITIS MEDIA - ACUTE & CHRONIC", "ear pain or pus discharge from the ear", False),
    ("mastoiditis", "OTITIS MEDIA - ACUTE & CHRONIC", "ear discharge with painful swelling behind the ear", True),
    ("cold_urti", "COLDS/ URTI", "runny nose, mild cough, no fast breathing, feeding well", False),
    ("conjunctivitis", "CONJUNCTIVITIS, ORBITAL CELLULITIS (PRE-SEPTAL & SEPTAL)", "red sticky eyes, or swelling around the eye", True),
    ("skin_scabies", "SKIN DISEASES", "itchy rash in the whole family, worse at night", False),
    ("skin_impetigo", "SKIN DISEASES", "pus-filled sores on the skin", False),
    ("skin_bakua", "SKIN DISEASES", "ringworm / bakua (tinea) patches", True),
    ("worms", "WORM & OTHER PARASITIC INFECTIONS", "worms seen in stool, swollen belly, itchy bottom", True),
    ("uti", "URINARY TRACT INFECTION", "pain passing urine, fever, smelly urine", False),
    ("pertussis", "PERTUSSIS (WHOOPING COUGH)", "coughing fits with whoop or vomiting after cough, baby going blue with cough", False),
    ("tb_suspect", "TUBERCULOSIS", "cough more than 2 weeks, weight loss, household TB contact, night sweats", False),
    ("newborn_infection", "NEWBORN BABIES - NEONATAL INFECTIONS", "baby under 1 month with fever, poor feeding, or umbilical redness", False),
    ("newborn_jaundice", "NEWBORN BABIES- JAUNDICE", "yellow skin or eyes in a newborn", True),
    ("newborn_lbw", "NEWBORN BABIES LESS THAN 2.5 KG WEIGHT", "small newborn under 2.5 kg, keeping warm and feeding", False),
    ("newborn_care", "EARLY ESSENTIAL NEWBORN CARE", "care right after birth: drying, skin to skin, cord care, first feed", False),
    ("hypoglycaemia", "HYPOGLYCAEMIA", "sick child who is drowsy, not feeding, low blood sugar", False),
    ("poisoning", "POISONING", "child swallowed kerosene, tablets or a plant", True),
    ("danger_signs_check", "THE 10-STEP CHECKLIST FOR CHILDREN", "general check of a sick child: danger signs, cough, diarrhoea, fever, ear, anaemia, malnutrition, immunisation", False),
    ("immunisation", "SOLOMON ISLANDS IMMUNISATION SCHEDULE", "which vaccines are due at this age, missed doses", False),
    ("transfer_advice", "ADVICE FOR TRANSFERING PATIENTS", "how to prepare a child for transfer: fluids, antibiotics, oxygen, referral letter", False),
    ("drug_dose", "PAEDIATRIC DRUG DOSES", "how much of a common drug to give by weight", False),
    ("rheumatic", "RHEUMATIC FEVER", "painful swollen joints after sore throat, heart murmur", True),
    ("osteomyelitis", "OSTEOMYELITIS, SEPTIC ARTHRITIS, PYOMYOSITIS", "painful hot swollen limb or joint, refusing to walk", True),
    ("sti_congenital", "SEXUALLY TRANSMITTED (& CONGENITAL) INFECTIONS", "newborn with sticky eyes or mother with STI; child with genital discharge", False),
    ("lymph", "LYMPHADENOPATHY", "swollen glands in neck", True),
    ("surgical", "SURGICAL PROBLEMS", "hernia, swollen painful scrotum, abdominal distension, cannot pass stool", True),
    ("oedema", "OEDEMA", "swelling of feet or face", False),
    ("glomerulonephritis", "GLOMERULONEPHRITIS", "dark cola urine, puffy face, after skin sores", True),
    ("breastfeeding", "BREAST FEEDING", "mother asks about breastfeeding problems, baby not gaining weight", False),
]
PRESENTATION_WEIGHTS = {p[0]: 1.0 for p in PRESENTATIONS}
for _p in ("fever_2d", "malaria_rdt_pos", "cough_fast_breathing", "diarrhoea_some_dehyd", "pneumonia_severe",
           "malaria_severe", "danger_signs_check", "drug_dose", "newborn_infection", "malnutrition_sam"):
    PRESENTATION_WEIGHTS[_p] = 2.0

ABSTAIN_HINTS = [
    "adult patient (over 15 years): chest pain, hypertension, diabetes, pregnancy bleeding, adult dose request",
    "request to read an X-ray, ultrasound, photo or lab image",
    "drug or dose that is not in the manual (e.g. adult antibiotics, chemotherapy, traditional medicine dosing)",
    "non-health request (boat schedule, pay, writing a letter to the ministry, translation of a song)",
    "asks for a definite diagnosis without examination ('what disease is this')",
    "obstetric care: labour, antenatal bleeding, postpartum problems of the mother",
    "mental health or substance use in a teenager",
    "legal or child protection decision beyond the manual (who to report to, custody)",
    "veterinary or livestock question",
    "question about a vaccine not in the Solomon Islands schedule, or travel vaccines",
]

FLAG_RDT = ["yes", "no", "unknown"]
FLAG_ACT = ["yes", "no", "unknown"]
FLAG_TRANSPORT = ["now", "next_boat", "none"]

_tls = threading.local()
_lock = threading.Lock()


# ----------------------------------------------------------------------------- style guide
def load_style():
    text = STYLE.read_text(encoding="utf-8")
    sys_prompt = re.search(r"## SYSTEM_PROMPT\s+```text\n(.*?)\n```", text, re.S).group(1).strip()
    red = re.search(r"## RED_FLAGS\s+```text\n(.*?)\n```", text, re.S).group(1).strip().splitlines()
    gloss_rows = re.findall(r"^\| ([^|]+?) \| ([^|]+?) \|$", text, re.M)
    glossary = [(a.strip(), b.strip()) for a, b in gloss_rows if a.strip() not in ("Pijin", "---")]
    pij_style = re.search(r"## Pijin style\n(.*?)\n## GLOSSARY", text, re.S).group(1).strip()
    exemplars = []
    for m in re.finditer(r"### exemplar (\d+): (\w+) / (\w+)[^\n]*\n\s*```user\n(.*?)\n```\s*```assistant\n(.*?)\n```", text, re.S):
        exemplars.append({"n": int(m.group(1)), "task": m.group(2), "lang": m.group(3),
                          "user": m.group(4).strip(), "assistant": m.group(5).strip()})
    assert len(exemplars) >= 10, f"only {len(exemplars)} exemplars parsed"
    return {"system": sys_prompt, "red_flags": red, "glossary": glossary, "pijin_style": pij_style,
            "exemplars": exemplars, "protocol": re.search(r"## Output protocol.*?\n```\n(.*?)\n```", text, re.S).group(1)}


# ----------------------------------------------------------------------------- corpus
def load_corpus():
    chunks = [json.loads(l) for l in CHUNKS.open(encoding="utf-8")]
    sections = json.load(SECTIONS.open(encoding="utf-8"))
    titles = [s["title"] for s in sections]
    by_section: dict[str, list[dict]] = {}
    for c in chunks:
        by_section.setdefault(c["section"], []).append(c)
    for p in PRESENTATIONS:
        assert p[1] in by_section, f"presentation {p[0]} points to unknown section {p[1]!r}"
    return chunks, titles, by_section


_tok = None


def excerpt(chunk: dict, max_tokens: int = 350) -> str:
    """Whitespace-collapsed chunk text, truncated to <= max_tokens Qwen tokens."""
    global _tok
    text = re.sub(r"\s+", " ", chunk["text"]).strip()
    if _tok is None:
        try:
            from transformers import AutoTokenizer
            _tok = AutoTokenizer.from_pretrained("Qwen/Qwen3.5-0.8B")
        except Exception:  # noqa: BLE001
            _tok = False
    if _tok:
        ids = _tok(text).input_ids
        if len(ids) > max_tokens:
            text = _tok.decode(ids[:max_tokens]).rstrip() + " ..."
    else:
        words = text.split()
        if len(words) > int(max_tokens * 0.7):
            text = " ".join(words[: int(max_tokens * 0.7)]) + " ..."
    return text


# ----------------------------------------------------------------------------- jobs
def weighted_choice(rng, mix: dict):
    r = rng.random()
    acc = 0.0
    for k, v in mix.items():
        acc += v
        if r <= acc:
            return k
    return list(mix)[-1]


def age_weight(rng, section: str):
    if section.startswith(("NEWBORN", "EARLY ESSENTIAL", "RESUSCITATION OF NEWBORN")):
        m = rng.choice([0, 0, 0, 1])
        return m, round(rng.uniform(1.8, 4.2), 1)
    m = rng.choice([2, 3, 4, 6, 8, 9, 10, 12, 14, 18, 24, 30, 36, 42, 48, 54, 60, 72, 84, 96, 120, 144])
    if m < 12:
        w = 3.5 + 0.5 * m
    elif m < 60:
        w = 2 * (m / 12) + 8
    else:
        w = 3 * (m / 12) + 3
    return m, round(w + rng.uniform(-1.5, 1.5), 1)


def make_jobs(n_examples: int, seed: int, kimi_share: float, held_out_in_train: bool, only_held_out: bool = False):
    """Deterministic job list; each job = one teacher call for PER_CALL examples."""
    rng = random.Random(seed)
    n_calls = (n_examples + PER_CALL - 1) // PER_CALL
    if only_held_out:
        pres = [p for p in PRESENTATIONS if p[3]]
    else:
        pres = [p for p in PRESENTATIONS if held_out_in_train or not p[3]]
    pres_w = [PRESENTATION_WEIGHTS[p[0]] for p in pres]
    jobs = []
    for i in range(n_calls):
        task = weighted_choice(rng, TASK_MIX)
        lang = weighted_choice(rng, LANG_MIX)
        if task == "abstain":
            gmode = rng.choice(["none", "none", "wrong"])
        else:
            r = rng.random()
            gmode = "match" if r < 0.75 else ("wrong" if r < 0.90 else "none")
        p = rng.choices(pres, weights=pres_w, k=1)[0]
        teacher = TEACHER_SECONDARY if rng.random() < kimi_share else TEACHER_PRIMARY
        items = []
        for k in range(PER_CALL):
            age, wt = age_weight(rng, p[1])
            items.append({
                "age_months": age, "weight_kg": wt,
                "flags": {"rdt": rng.choice(FLAG_RDT), "act": rng.choice(FLAG_ACT),
                          "transport": rng.choice(FLAG_TRANSPORT)},
                "abstain_hint": rng.choice(ABSTAIN_HINTS) if task == "abstain" else None,
            })
        jobs.append({"job": f"j{seed}-{i:05d}", "task": task, "lang": lang, "gmode": gmode,
                     "presentation": p[0], "section": p[1], "hint": p[2], "teacher": teacher,
                     "items": items, "seed": rng.randrange(1 << 30)})
    return jobs


# ----------------------------------------------------------------------------- prompts
TASK_INSTRUCTIONS = {
    "guidance": "The nurse describes a sick child and asks what to do. The assistant answers strictly from the guideline excerpt: what to check, what to give (dose computed from the weight, in mg, from the excerpt only), when to come back, and the danger signs to watch. ACTION is ADVISE unless a red flag is present (then REFER_NOW / REFER_NEXT_TRANSPORT) or the excerpt does not cover the question (then ASK_PERSON).",
    "referral": "The nurse describes a child with one or more red flags, a severe classification, or treatment that failed. ACTION must be REFER_NOW when transport=now or transport=none (then tell the nurse to call the AHC/hospital by phone or radio and start pre-referral treatment), and REFER_NEXT_TRANSPORT when transport=next_boat and the manual allows pre-referral treatment (then say exactly what to give while waiting, with doses from the excerpt). Always say what to do before and during transfer and what to write in the referral note.",
    "note": "The nurse dictates a visit note (age, weight, symptoms, findings, what was given, what was advised). The assistant returns ACTION and STM lines, then '---', then ONE JSON object only (no prose, no markdown) with keys age_months (int), weight_kg (number), symptoms (list of short strings), danger_signs (list), assessment_per_stm (string citing the section), action (same as ACTION), drugs (list of {name,dose,route,frequency}), follow_up (string), referral (string or null). Pijin notes keep Pijin inside the JSON strings.",
    "followup": "The nurse asks for a short message for the caregiver (SMS length, one paragraph, at most 4 sentences, no list): how to give the medicine, what to avoid, danger signs that mean come back now, and when to return. ACTION is ADVISE (or REFER_* if the child was referred). STM is the section used.",
    "abstain": "The nurse asks something the manual does not cover (see the out-of-scope hint). The assistant must answer ACTION: ASK_PERSON and STM: NONE and, after '---', say plainly that it is not sure / out of scope, name WHO to ask (nurse in charge, doctor at the AHC or NRH by phone or radio) and WHAT to tell them, plus one safe immediate step if relevant. Never give a dose or a diagnosis here.",
}

LANG_INSTRUCTIONS = {
    "pis": "Both the nurse message and the reply are in Solomon Islands Pijin (flag lang=pis). Follow the Pijin style guide and glossary; drug names, numbers and units stay in English.",
    "en": "Both the nurse message and the reply are in plain English (flag lang=en), as spoken by a Solomon Islands nurse aide.",
    "mix": "The nurse writes code-switched Pijin with English clinical terms (flag lang=pis), for example 'pikinini garem fast breathing an chest indrawing, mi givim amoxycillin'. The reply is in Pijin with English clinical terms, the way a nurse would talk.",
}


def build_prompt(style: dict, job: dict, chunk: dict | None, titles: list[str]):
    rng = random.Random(job["seed"])
    ex_same = [e for e in style["exemplars"] if e["task"] == job["task"]]
    ex_other = [e for e in style["exemplars"] if e["task"] != job["task"]]
    rng.shuffle(ex_same)
    rng.shuffle(ex_other)
    lang_pref = "pis" if job["lang"] in ("pis", "mix") else "en"
    ex_other.sort(key=lambda e: 0 if e["lang"] == lang_pref else 1)
    picked = (ex_same[:2] + ex_other[:1]) if len(ex_same) >= 2 else (ex_same + ex_other[:3 - len(ex_same)])
    gl = "\n".join(f"{a} = {b}" for a, b in style["glossary"])
    red = "\n".join(f"- {r}" for r in style["red_flags"])
    exemplar_text = "\n\n".join(
        f"EXAMPLE {i + 1} ({e['task']}, {e['lang']})\nUSER:\n{e['user']}\nASSISTANT:\n{e['assistant']}"
        for i, e in enumerate(picked))
    system = f"""You write training data for a small on-device assistant called Lokol Health. The assistant's system prompt is:
\"\"\"{style['system']}\"\"\"

The assistant's reply must follow this protocol exactly:
{style['protocol']}

ACTION rules: any red flag in the nurse's message forces REFER_NOW (or REFER_NEXT_TRANSPORT when transport=next_boat and pre-referral treatment is possible, in which case the reply states what to give while waiting). transport=none with a red flag is still REFER_NOW and the reply says to call the AHC/hospital by radio or phone. If the guideline excerpt is missing ([guideline: none]) or clearly about a different problem, the assistant must not invent guidance: ACTION: ASK_PERSON, STM: NONE, and the reply says what to ask whom, except when a red flag is present (then REFER_NOW and the correct STM section may be named).
Red flags:
{red}

STM line: the section title must be copied exactly from this list (or NONE):
{chr(10).join(titles)}

Pijin style guide:
{style['pijin_style']}

Glossary (Pijin = English):
{gl}

Quality rules: plain words, at most 6 short lines after '---' (one JSON object for note), no markdown, no bullet symbols, no headings, no diagnosis, every dose computed from the child's weight using only numbers present in the excerpt, never cite a page or drug that is not in the excerpt. The nurse messages must be realistic and varied: different wording, sometimes missing the weight, sometimes with typos, sometimes with local detail (village, boat, radio, clinic stock). Each of the 5 examples must differ in presentation details and wording.
Diversity rules: never copy sentences from the examples below; they show the format and register only. Vary the opening line of each reply (start with the decision, the test, the dose, the referral step, or the main finding; do not always start with the danger-sign checklist, and skip the generic checklist when the nurse already says there are no danger signs). Within one batch, no two replies may share an identical line, and no two nurse messages may share an opening phrase.
Language purity: when the flag is lang=en the whole reply is English with no Pijin words at all (write "I am not sure", not "Mi no sua"); when lang=pis the reply is Pijin (English clinical terms, drug names and numbers are fine).

{exemplar_text}"""

    flags_lines = []
    for k, it in enumerate(job["items"], 1):
        f = it["flags"]
        extra = f" Out-of-scope hint: {it['abstain_hint']}." if it["abstain_hint"] else ""
        flags_lines.append(f"{k}. child age {it['age_months']} months, weight about {it['weight_kg']} kg, "
                           f"flags [rdt={f['rdt']}] [act={f['act']}] [transport={f['transport']}].{extra}")
    if job["gmode"] == "none" or chunk is None:
        gline = "[guideline: none]"
        gnote = "No guideline excerpt is available for these 5 examples (retrieval found nothing)."
    else:
        gline = f"[guideline: {chunk['section']} p{chunk['page']}] {excerpt(chunk)}"
        if job["gmode"] == "wrong":
            gnote = ("The retrieved guideline below is DELIBERATELY WRONG for the nurse's problem (retrieval error). "
                     "The assistant must notice this: ASK_PERSON with STM: NONE, unless a red flag is present (then REFER_NOW and the correct section name).")
        else:
            gnote = "The guideline excerpt below matches the nurse's problem; answer from it."
    user = f"""Generate {PER_CALL} examples.
Task type: {job['task']}. {TASK_INSTRUCTIONS[job['task']]}
Language: {LANG_INSTRUCTIONS[job['lang']]}
{("Presentation theme: " + job['hint'] + " (STM section: " + job['section'] + ").") if job['task'] != 'abstain' else "Presentation: each nurse message is ONLY about the out-of-scope topic given in its seed line (no sick-child case mixed in); the age/weight seeds may be ignored or used for an adult/other person as the hint requires."}
{gnote}
Guideline line that will be placed in every user turn:
{gline}

Per-example seeds (use these ages, weights and flags; the flags tell the assistant what is available: rdt = malaria test kit, act = artemether-lumefantrine, transport = how soon the child can be moved):
{chr(10).join(flags_lines)}

Return ONLY a JSON array of {PER_CALL} objects, each {{"nurse_message": "<what the nurse writes, 1-4 sentences, no flags, no guideline>", "assistant": "<complete assistant turn starting with 'ACTION: '>"}}. No prose before or after the JSON, no code fences."""
    return [{"role": "system", "content": system}, {"role": "user", "content": user}], gline


# ----------------------------------------------------------------------------- teacher call
def get_client():
    if getattr(_tls, "client", None) is None:
        from river_client import Client
        key = os.environ.get("RIVER_API_KEY")
        if not key:
            for l in (ROOT / ".env").read_text().splitlines():
                if l.startswith("RIVER_API_KEY="):
                    key = l.split("=", 1)[1].strip().strip('"\'')
        if not key:
            raise SystemExit("RIVER_API_KEY not set (set -a; . ./.env; set +a)")
        _tls.client = Client(api_key=key)
    return _tls.client


def parse_array(text: str) -> list[dict]:
    t = text.strip()
    t = re.sub(r"^```(?:json)?\s*|\s*```$", "", t, flags=re.S).strip()
    i, j = t.find("["), t.rfind("]")
    if i < 0:
        raise ValueError("no JSON array in response")
    if j > i:
        try:
            arr = json.loads(t[i:j + 1])
            if isinstance(arr, list):
                return arr
        except json.JSONDecodeError:
            pass
    # salvage complete objects from a truncated array (hit max_tokens mid-string)
    dec = json.JSONDecoder()
    pos, out = i + 1, []
    while True:
        while pos < len(t) and t[pos] in " \n\r\t,":
            pos += 1
        if pos >= len(t) or t[pos] != "{":
            break
        try:
            obj, end = dec.raw_decode(t, pos)
        except json.JSONDecodeError:
            break
        out.append(obj)
        pos = end
    if not out:
        raise ValueError("no complete objects in truncated response")
    return out


def run_job(job: dict, style: dict, by_section: dict, chunks: list[dict], titles: list[str], max_tokens: int):
    rng = random.Random(job["seed"])
    chunk = None
    if job["gmode"] == "match":
        chunk = rng.choice(by_section[job["section"]])
    elif job["gmode"] == "wrong":
        others = [c for c in chunks if c["section"] != job["section"]]
        chunk = rng.choice(others)
    messages, gline = build_prompt(style, job, chunk, titles)
    t0 = time.time()
    client = get_client()
    last_err = None
    for attempt in range(2):
        try:
            res = client.chat_complete(messages, base_model=job["teacher"], max_tokens=max_tokens, temperature=0.7,
                                       timeout=420, chat_template_kwargs={"enable_thinking": False})
            payload = json.loads(res.response_json) if isinstance(res.response_json, str) else res.response_json
            content = payload["choices"][0]["message"]["content"]
            usage = payload.get("usage", {})
            arr = parse_array(content)
            break
        except Exception as e:  # noqa: BLE001
            last_err = f"{type(e).__name__}: {str(e)[:300]}"
            time.sleep(2)
    else:
        return {"job": job["job"], "error": last_err, "secs": round(time.time() - t0, 1)}, []
    rows = []
    for k, obj in enumerate(arr[:PER_CALL]):
        if not isinstance(obj, dict):
            continue
        msg = str(obj.get("nurse_message", "")).strip()
        asst = str(obj.get("assistant", "")).strip()
        if not msg or not asst:
            continue
        it = job["items"][k] if k < len(job["items"]) else job["items"][-1]
        f = it["flags"]
        lang_flag = "en" if job["lang"] == "en" else "pis"
        user = f"[lang={lang_flag}] [rdt={f['rdt']}] [act={f['act']}] [transport={f['transport']}]\n{gline}\n{msg}"
        rows.append({
            "id": f"{job['job']}-{k}", "job": job["job"], "task": job["task"], "lang": job["lang"],
            "flags": {"lang": lang_flag, **f}, "guideline_mode": job["gmode"],
            "chunk_id": chunk["id"] if chunk else None, "section": job["section"],
            "page": chunk["page"] if chunk else None, "presentation": job["presentation"],
            "age_months": it["age_months"], "weight_kg": it["weight_kg"],
            "teacher": job["teacher"], "user": user, "assistant": asst,
            "usage": {"prompt_tokens": usage.get("prompt_tokens"), "completion_tokens": usage.get("completion_tokens")},
        })
    return {"job": job["job"], "n": len(rows), "secs": round(time.time() - t0, 1), "teacher": job["teacher"],
            "usage": usage}, rows


# ----------------------------------------------------------------------------- main
def done_jobs(path: Path) -> set[str]:
    if not path.exists():
        return set()
    s = set()
    for l in path.open(encoding="utf-8"):
        try:
            s.add(json.loads(l)["job"])
        except Exception:  # noqa: BLE001
            pass
    return s


def quick_format_ok(asst: str, task: str) -> bool:
    m = re.match(r"ACTION: (ADVISE|REFER_NOW|REFER_NEXT_TRANSPORT|ASK_PERSON)\nSTM: (.+)\n---\n(.+)$", asst, re.S)
    if not m:
        return False
    body = m.group(3).strip()
    if task == "note":
        try:
            return isinstance(json.loads(body), dict)
        except Exception:  # noqa: BLE001
            return False
    return 1 <= len(body.splitlines()) <= 7 and "**" not in body and "#" not in body


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target", type=int, default=3600, help="raw examples to generate in total")
    ap.add_argument("--pilot", type=int, default=0, help="generate only this many examples first")
    ap.add_argument("--print", dest="nprint", type=int, default=0, help="print this many examples when done")
    ap.add_argument("--workers", type=int, default=24)
    ap.add_argument("--kimi-share", type=float, default=0.5, help="share of calls sent to the secondary teacher")
    ap.add_argument("--max-tokens", type=int, default=2400)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--out", default=str(RAW_OUT))
    ap.add_argument("--include-held-out", action="store_true", help="also generate held-out presentations (used for the test set)")
    ap.add_argument("--only-held-out", action="store_true", help="generate ONLY held-out presentations (test-set run; write to a separate --out)")
    args = ap.parse_args()

    style = load_style()
    chunks, titles, by_section = load_corpus()
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    n = args.pilot or args.target
    jobs = make_jobs(n, args.seed, args.kimi_share, args.include_held_out, args.only_held_out)
    done = done_jobs(out)
    todo = [j for j in jobs if j["job"] not in done]
    print(f"[synth] jobs={len(jobs)} done={len(jobs) - len(todo)} todo={len(todo)} workers={args.workers} "
          f"teachers: primary={TEACHER_PRIMARY} secondary={TEACHER_SECONDARY} kimi_share={args.kimi_share}", flush=True)
    excerpt(chunks[0])  # warm the tokenizer once before threads start

    t0 = time.time()
    n_rows = n_fail = 0
    tok_in = tok_out = 0
    secs_by_teacher: dict[str, list[float]] = {}
    with ThreadPoolExecutor(max_workers=args.workers) as ex, out.open("a", encoding="utf-8") as fo, \
            FAIL_OUT.open("a", encoding="utf-8") as ff:
        futs = {ex.submit(run_job, j, style, by_section, chunks, titles, args.max_tokens): j for j in todo}
        for i, fut in enumerate(as_completed(futs), 1):
            info, rows = fut.result()
            with _lock:
                if "error" in info:
                    n_fail += 1
                    ff.write(json.dumps(info) + "\n")
                    ff.flush()
                else:
                    for r in rows:
                        fo.write(json.dumps(r, ensure_ascii=False) + "\n")
                    fo.flush()
                    n_rows += len(rows)
                    u = info.get("usage") or {}
                    tok_in += u.get("prompt_tokens") or 0
                    tok_out += u.get("completion_tokens") or 0
                    secs_by_teacher.setdefault(info["teacher"].split("/")[-1], []).append(info["secs"])
                el = time.time() - t0
                rate = n_rows / el * 60 if el else 0
                print(f"[synth] {i}/{len(todo)} calls, rows={n_rows}, fails={n_fail}, "
                      f"{el:.0f}s, {rate:.0f} rows/min, last={info.get('secs')}s {info.get('error', '')[:80]}", flush=True)
    avg = {k: round(sum(v) / len(v), 1) for k, v in secs_by_teacher.items()}
    # cost estimate: assumed $0.30/M prompt, $1.20/M completion (River list prices not fetched; adjust in DATA_CARD)
    cost = tok_in / 1e6 * 0.30 + tok_out / 1e6 * 1.20
    print(f"[synth] done: rows={n_rows} fails={n_fail} prompt_tokens={tok_in} completion_tokens={tok_out} "
          f"est_cost=${cost:.2f} avg_secs={avg}", flush=True)

    if args.nprint:
        rows = [json.loads(l) for l in out.open(encoding="utf-8")]
        ok = sum(quick_format_ok(r["assistant"], r["task"]) for r in rows)
        print(f"[synth] format compliance (quick regex): {ok}/{len(rows)} = {ok / max(1, len(rows)):.0%}")
        rnd = random.Random(1)
        for r in rnd.sample(rows, min(args.nprint, len(rows))):
            print("=" * 80)
            print(f"[{r['id']}] task={r['task']} lang={r['lang']} gmode={r['guideline_mode']} teacher={r['teacher'].split('/')[-1]} pres={r['presentation']}")
            print("USER:\n" + r["user"][:900])
            print("ASSISTANT:\n" + r["assistant"])


if __name__ == "__main__":
    main()
