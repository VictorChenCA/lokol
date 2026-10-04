"""Publish Lokol's trained phone models and the Pijin TTS export to the Hugging Face Hub (public repos under VictorChenCA).

    set -a; . ./.env; set +a        # HF_TOKEN with write access
    .venv/bin/python pipeline/publish_hf.py [--only 0.6b|1.7b|tts]
    .venv/bin/python pipeline/publish_hf.py --deploy-only     # card + Ollama files, no GGUF re-upload

Repo names match app/src/models.ts and app/public/packs/health/manifest.json.
Each GGUF repo also gets deploy/ollama/{template,system,params}, which `ollama run hf.co/<repo>` reads:
ChatML with thinking off (the GGUF's own Qwen3 template would think), the training system prompt, temperature 0.2.
"""
import argparse, json, os, re
from pathlib import Path
from huggingface_hub import HfApi, create_repo, CommitOperationAdd

ROOT = Path(__file__).resolve().parents[1]
OWNER = "VictorChenCA"
GITHUB = "https://github.com/VictorChenCA/lokol"
OLLAMA_DIR = ROOT / "deploy" / "ollama"
OLLAMA_FILES = ("template", "system", "params")
INSTALLER = "https://raw.githubusercontent.com/VictorChenCA/lokol/main/deploy/lokol-laptop.sh"

# The Lokol protocol: flags line, guideline line, nurse message (STM FEVER p40, quoted from the manual).
EXAMPLE_PROMPT = (
    "[lang=pis] [rdt=yes] [act=yes] [transport=next_boat]\n"
    "[guideline: FEVER p40] Fever is defined as an axillary temperature greater than 37.5 C. INVESTIGATIONS: consider blood film "
    "or rapid diagnostic test for malaria parasites. MANAGEMENT: treat the cause of the fever; consider giving paracetamol if fever "
    "above 38 C AND the child is irritable: dose 15 mg/kg (max 1 g) every 4 to 6 hours (maximum 4 doses in 24 hours); do not use "
    "aspirin in children for fever; give extra fluids.\n"
    "Pikinini 3 yia, 13 kilo, hot bodi fo tufala dei, hem kros an no laek kaikai tumas. Wanem mi mas duim?"
)


def style_guide_system_prompt():
    sg = (ROOT / "pipeline" / "style_guide.md").read_text()
    return re.search(r"## SYSTEM_PROMPT\s*\n\s*```text\n(.*?)\n```", sg, re.S).group(1)


def ollama_files():
    """deploy/ollama files, checked against the training system prompt and the protocol's stop token."""
    files = [OLLAMA_DIR / n for n in OLLAMA_FILES]
    for f in files:
        assert f.exists(), f"missing {f}"
    assert (OLLAMA_DIR / "system").read_text() == style_guide_system_prompt(), "deploy/ollama/system differs from style_guide SYSTEM_PROMPT"
    params = json.loads((OLLAMA_DIR / "params").read_text())
    assert "<|im_end|>" in params["stop"] and params["num_ctx"] >= 4096, params
    assert "<think>" in (OLLAMA_DIR / "template").read_text(), "template must pre-fill an empty think block"
    return files


def ollama_section(repo, size):
    lines = EXAMPLE_PROMPT.split("\n")
    repl = '>>> """' + lines[0] + "\n" + "\n".join("... " + l for l in lines[1:]) + '"""'
    return f"""## Run it in one line (Ollama)
```sh
ollama run hf.co/{repo}
```
Ollama reads `template`, `system` and `params` from this repo: Qwen3 ChatML with thinking off (as in training), the Lokol system
prompt, temperature 0.2 and a 4k context. Every message is three lines in the Lokol protocol: flags, one manual excerpt, the nurse's
message. Wrap multi-line input in triple quotes:
```text
{repl}
```
Expected shape of the reply:
```text
ACTION: ADVISE
STM: FEVER
---
<up to 6 short lines in Pijin: danger signs to check, RDT, paracetamol by weight, no aspirin, fluids, when to come back>
```
Use `[guideline: none]` when the manual has nothing on the question; the model should answer `ACTION: ASK_PERSON`.
To serve the Lokol bridge (WhatsApp, Messenger) from Ollama:
`LLM_URL=http://127.0.0.1:11434/v1/chat/completions LLM_MODEL=hf.co/{repo} .venv/bin/python -m bridge.server`
(Ollama ignores the bridge's llama.cpp health probe, so `/health` reports the model as not ready; replies still work.)
"""


def metrics(name):
    p = ROOT / "eval" / f"{name}.json"
    if not p.exists():
        return None
    d = json.load(open(p))
    m, s, a = d["metrics"], d.get("system", {}), d.get("dose_audit", {})
    return m, s, a


def pct(x):
    return "n/a" if x is None else f"{round(100 * x)}%"


def gguf_card(size, base_repo, tuned_name, base_name, file, repo):
    tm, bm = metrics(tuned_name), metrics(base_name)
    rows = ""
    if tm and bm:
        for label, key in [("Follows the output protocol", "format_compliance"), ("Right action (advise / refer / ask a person)", "action_acc"),
                           ("Cites the right manual section", "stm_acc"), ("Danger signs referred", "red_flag_recall"),
                           ("Says 'ask a person' when it should", "abstain_recall"), ("Replies in Pijin when asked", "pijin_glossary_hit_rate")]:
            rows += f"| {label} | {pct(bm[0].get(key))} | {pct(tm[0].get(key))} |\n"
    table = ("| Held-out test (300 synthetic cases) | Base | Lokol Health |\n|---|---|---|\n" + rows) if rows else "Evaluation: see the GitHub repo."
    return f"""---
license: apache-2.0
base_model: {base_repo}
language: [pis, en]
library_name: gguf
pipeline_tag: text-generation
tags: [lokol, small-ai, offline, solomon-islands-pijin, health, llama.cpp, gguf, world-bank-small-ai]
---
# Lokol Health {size} (GGUF, Q4_K_M)

A LoRA fine-tune of [{base_repo}](https://huggingface.co/{base_repo}) for **Lokol Health**: an offline assistant for nurse aides in rural
Solomon Islands, in **Solomon Islands Pijin** and English, grounded in the Ministry of Health's *Standard Treatment Manual for Children* (2017).
Built with [Lokol Studio]({GITHUB}) for Hack-Nation 7 x World Bank "Small AI for Development" (Health track).

**Not a medical device. Not for clinical use.** A prototype trained on synthetic data and not validated by clinicians.

## What it does
Given a nurse's message, flags (`[lang=pis] [rdt=yes] [act=yes] [transport=next_boat]`) and one retrieved manual excerpt
(`[guideline: SECTION pN] ...`), it answers in a fixed protocol:
```
ACTION: ADVISE | REFER_NOW | REFER_NEXT_TRANSPORT | ASK_PERSON
STM: <manual section> | NONE
---
<at most 6 short lines in the nurse's language>
```
It never diagnoses. In the Lokol app and bridge, every reply passes a rule-based safety gate (danger signs force referral, no guideline
means "ask a person", and no dose is shown unless the cited page gives it for that drug).

{ollama_section(repo, size)}
## Evaluation
{table}
Full results, safety-gate scores and the dose audit: {GITHUB}/blob/main/eval/results.md

## Training
LoRA (mlx-lm, all 28 layers, rank 8) on 2,704 synthetic cases generated by open-weight teachers (DeepSeek-V4.1-Flash, Kimi-K2.6 via River AI)
from the manual, then fused and quantized with llama.cpp. Data card: {GITHUB}/blob/main/data/DATA_CARD.md

## Other ways to run it
- Phone browser, offline after the first load: https://lokol-studio.vercel.app/demo (Add to Home screen). It adds the guideline
  lookup and the safety gate that a bare chat app lacks.
- Android app: PocketPal AI (Google Play), Models, Add from Hugging Face, search `{repo}`, download `{file}`, then paste the
  system prompt from `system`. Step by step: {GITHUB}/blob/main/deploy/ANDROID.md
- Laptop or clinic PC, model + bridge in one command (macOS/Linux, needs llama.cpp and Python 3.10+):
  `curl -fsSL {INSTALLER} | bash -s -- --model {size.lower()}`
- By hand: `llama-server -m {file} --jinja -c 4096 --port 8080`, then the Lokol bridge (`LLM_BACKEND=llama`).

## Limitations
Synthetic training and test data; Pijin not reviewed by a native speaker; children's manual only; small models over-refer and can invent doses
(the Lokol dose guard replaces unsupported doses). Guideline excerpts are (c) Ministry of Health and Medical Services, Solomon Islands.
"""


def publish_card(api, repo, card, msg="Model card + Ollama template, system prompt and params"):
    """README plus deploy/ollama/{template,system,params} in one commit (no GGUF re-upload)."""
    create_repo(repo, repo_type="model", exist_ok=True, private=False, token=api.token)
    ops = [CommitOperationAdd(path_in_repo="README.md", path_or_fileobj=card.encode())]
    ops += [CommitOperationAdd(path_in_repo=f.name, path_or_fileobj=str(f)) for f in ollama_files()]
    api.create_commit(repo_id=repo, operations=ops, commit_message=msg)
    print(f"[hf] card + {', '.join(OLLAMA_FILES)} -> {repo}", flush=True)


def publish(api, repo, files, card, msg):
    publish_card(api, repo, card)
    for f in files:
        print(f"[hf] uploading {f.name} ({f.stat().st_size / 1e6:.0f} MB) -> {repo}", flush=True)
        api.upload_file(path_or_fileobj=str(f), path_in_repo=f.name, repo_id=repo, commit_message=msg)
    print(f"[hf] done https://huggingface.co/{repo}", flush=True)


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", choices=["0.6b", "1.7b", "tts"])
    ap.add_argument("--deploy-only", action="store_true", help="GGUF repos: model card + Ollama files only, keep the uploaded GGUF")
    ap.add_argument("--print-card", choices=["0.6b", "1.7b"], help="print a card and exit (no token needed)")
    a = ap.parse_args()
    if a.print_card:
        size = a.print_card.upper()
        print(gguf_card(size, f"Qwen/Qwen3-{size}", f"tuned-qwen3-{a.print_card}", f"base-qwen3-{a.print_card}",
                        f"lokol-health-qwen3-{a.print_card}-Q4_K_M.gguf", f"{OWNER}/lokol-health-qwen3-{a.print_card}-gguf"))
        raise SystemExit(0)
    api = HfApi(token=os.environ["HF_TOKEN"])
    g = ROOT / "models" / "gguf"
    jobs = [
        ("tts", f"{OWNER}/lokol-mms-tts-pis-onnx", ROOT / "app/src/runtime/dev/models/mms-tts-pis-onnx"),
        ("0.6b", f"{OWNER}/lokol-health-qwen3-0.6b-gguf", g / "lokol-health-qwen3-0.6b-Q4_K_M.gguf"),
        ("1.7b", f"{OWNER}/lokol-health-qwen3-1.7b-gguf", g / "lokol-health-qwen3-1.7b-Q4_K_M.gguf"),
    ]
    for key, repo, path in jobs:
        if a.only and a.only != key:
            continue
        if key == "tts":
            if a.deploy_only:
                continue
            create_repo(repo, repo_type="model", exist_ok=True, private=False, token=api.token)
            api.upload_folder(folder_path=str(path), repo_id=repo, commit_message="ONNX export of facebook/mms-tts-pis for transformers.js (Lokol Health)")
            print(f"[hf] done https://huggingface.co/{repo}", flush=True)
            continue
        size = "0.6B" if key == "0.6b" else "1.7B"
        card = gguf_card(size, f"Qwen/Qwen3-{size}", f"tuned-qwen3-{key}", f"base-qwen3-{key}", path.name, repo)
        if a.deploy_only:
            publish_card(api, repo, card)
        else:
            publish(api, repo, [path], card, f"Lokol Health {size} Q4_K_M")
