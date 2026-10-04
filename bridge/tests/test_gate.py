import pytest

from bridge.gate import (
    apply_gate,
    canonical_section,
    detect_lang,
    format_for_channel,
    match_red_flags,
    parse_reply,
)

SECTIONS = ["FEVER", "MALARIA", "PNEUMONIA", "DIARRHOEA", "MENINGITIS", "CONVULSIONS", "MALNUTRITION", "BURNS AND SCALDS"]


def _ids(msg: str) -> set[str]:
    return {r["id"] for r in match_red_flags(msg)}


@pytest.mark.parametrize(
    "msg,expected",
    [
        ("child had a convulsion this morning", "convulsions"),
        ("the child is fitting", "convulsions"),
        ("pikinini hem sek-sek", "convulsions"),
        ("she cannot drink anything", "unable_to_drink"),
        ("bebi no save susu", "unable_to_drink"),
        ("vomits everything we give", "vomits_everything"),
        ("pikinini toraot evri samting", "vomits_everything"),
        ("child is lethargic and hard to wake", "lethargic_unconscious"),
        ("hem slip tumas, no save wekap", "lethargic_unconscious"),
        ("fast breathing with chest indrawing", "breathing_danger"),
        ("pikinini brit hariap and chest go insaet", "breathing_danger"),
        ("fever and stiff neck", "stiff_neck"),
        ("hot bodi an nek stif", "stiff_neck"),
        ("sunken eyes and no urine for 8 hours", "severe_dehydration"),
        ("ai go insaet, no pispis", "severe_dehydration"),
        ("visible wasting and oedema of both feet", "severe_malnutrition"),
        ("tufala leg swel, bon tumas", "severe_malnutrition"),
        ("bleeding from the nose that will not stop", "bleeding"),
        ("blad kamaot long nus", "bleeding"),
        ("lips are blue", "cyanosis"),
        ("maot hem blu", "cyanosis"),
        ("burns to the face after the kerosene lamp fell", "burns_face_airway"),
        ("faea bonem fes blong hem", "burns_face_airway"),
        ("baby 3 weeks old with fever", "young_infant_fever"),
        ("bebi 10 dei ol hem hot bodi", "young_infant_fever"),
        ("newborn with temperature 38.5", "young_infant_fever"),
    ],
)
def test_red_flags_match(msg, expected):
    assert expected in _ids(msg)


@pytest.mark.parametrize(
    "msg",
    [
        "child with fever for 2 days, drinking well",  # '2 days' is duration, not age
        "pikinini hot bodi 3 dei, hem dring gud",
        "mild cough, no fast breathing, playing normally",
        "5 year old with fever and cough",
        "2 year old, cough 3 days, breathing rate 52, no chest indrawing, drinking well",  # negated
        "pikinini kof, nomoa fit, hem dring gud",  # negated Pijin
        "no convulsions, not lethargic, no stiff neck, without bleeding",
        # negated phrases from app/src/runtime/gate.ts stripNegated(): app and bridge must agree
        "Pikinini 3 yia, hot bodi tu dei, no kaikai gud. No fit.",
        "Visit note: no danger signs, RDT positive",
        "pikinini hot bodi, nogat fit, hem dring gud",
        "pikinini kof, nomoa sek-sek",
        "fever 2 days, neva fit, no stiff neck",
        "child 3 years, fever, no any fits, eating ok",
        "pikinini hot bodi, nating sek-sek, no blad",
    ],
)
def test_red_flags_no_false_positive(msg):
    ids = _ids(msg)
    assert ids == set(), ids


def test_negation_does_not_mask_a_real_flag():
    assert "convulsions" in _ids("no cough but had a convulsion last night")
    assert "convulsions" in _ids("nogat kof, hem sek-sek tude")
    assert "bleeding" in _ids("Pikinini 3 yia, hem blad i kam aot")
    assert "breathing_danger" in _ids("not drinking well and chest indrawing present")


@pytest.mark.parametrize(
    "msg,lang",
    [
        ("pikinini blong mi hem garem hot bodi tu dei nao", "pis"),
        ("bebi hem toraot evri samting, wanem mi duim?", "pis"),
        ("mi no sua, askem nes", "pis"),
        ("Child with fever for two days, what should I give?", "en"),
        ("3 year old, 13 kg, cough and fast breathing", "en"),
        ("/rdt no", "en"),
        ("", "en"),
    ],
)
def test_detect_lang(msg, lang):
    assert detect_lang(msg) == lang


def test_parse_reply_full():
    p = parse_reply("ACTION: ADVISE\nSTM: MALARIA\n---\nGive AL by weight.\nReturn in 2 days.")
    assert p.compliant and p.action == "ADVISE" and p.stm == "MALARIA"
    assert p.body == "Give AL by weight.\nReturn in 2 days."


def test_parse_reply_strips_thinking_and_markdown():
    p = parse_reply("<think>reasoning…</think>\nACTION: REFER_NOW\nSTM: PNEUMONIA\n---\n**Refer now.** Give *first dose* amoxicillin.")
    assert p.compliant and p.action == "REFER_NOW" and p.stm == "PNEUMONIA"
    assert "*" not in p.body


def test_parse_reply_none_stm():
    p = parse_reply("ACTION: ASK_PERSON\nSTM: NONE\n---\nMi no sua. Askem dokta.")
    assert p.compliant and p.action == "ASK_PERSON" and p.stm is None


def test_parse_reply_garbage_is_non_compliant():
    p = parse_reply("Sure! Here is what you should do: give paracetamol.")
    assert not p.compliant and p.action is None


def test_parse_reply_template_residue_is_non_compliant():
    p = parse_reply("ACTION: ADVISE\nSTM: MALARIA\n---\n<reply in the nurse's language, at most 6 short lines>")
    assert not p.compliant


def test_gate_echo_becomes_ask_person():
    msg = "pikinini blong mi hem hot bodi tu dei, RDT positive, 13 kg, wanem meresin mi givim?"
    parsed = parse_reply(f"ACTION: ADVISE\nSTM: MALARIA\n---\nRDT positive, 13 kg, wanem meresin mi givim?")
    r = apply_gate(msg, parsed, {"transport": "now"}, "MALARIA", "pis", SECTIONS)
    assert r.action == "ASK_PERSON" and "echo_of_message" in r.reasons and r.body.startswith("Mi no sua")


def test_parse_reply_note_json():
    p = parse_reply('ACTION: ADVISE\nSTM: FEVER\n---\n{"age_months": 36, "weight_kg": 13, "symptoms": ["fever 2 days"]}')
    assert p.compliant and p.body.startswith("{") and '"age_months": 36' in p.body


def test_canonical_section():
    assert canonical_section("Malaria", SECTIONS) == "MALARIA"
    assert canonical_section("burns & scalds", SECTIONS) == "BURNS AND SCALDS"
    assert canonical_section("ADULT CARDIOLOGY", SECTIONS) is None


def test_gate_red_flag_forces_refer_now():
    parsed = parse_reply("ACTION: ADVISE\nSTM: FEVER\n---\nGive paracetamol.")
    r = apply_gate("child with fever and a convulsion", parsed, {"transport": "now"}, "FEVER", "en", SECTIONS)
    assert r.action == "REFER_NOW" and r.overridden and r.stm == "FEVER"
    assert r.red_flags and r.red_flags[0]["id"] == "convulsions"
    assert r.body.startswith("REFER NOW")
    out = format_for_channel(r, "en", 40)
    assert out.startswith("[REFER NOW]") and "STM: FEVER p40" in out


def test_gate_red_flag_next_boat():
    parsed = parse_reply("ACTION: ADVISE\nSTM: FEVER\n---\nGivim paracetamol.")
    r = apply_gate("pikinini hem fit an hot bodi", parsed, {"transport": "next_boat"}, "FEVER", "pis", SECTIONS)
    assert r.action == "REFER_NEXT_TRANSPORT" and r.overridden
    assert "NEKIS BOT" in r.body


def test_gate_keeps_model_refer():
    parsed = parse_reply("ACTION: REFER_NOW\nSTM: MENINGITIS\n---\nRefer now. Give ceftriaxone first dose.")
    r = apply_gate("fever and stiff neck", parsed, {"transport": "now"}, "MENINGITIS", "en", SECTIONS)
    assert r.action == "REFER_NOW" and not r.overridden and r.body.startswith("Refer now")


def test_gate_non_compliant_becomes_ask_person():
    parsed = parse_reply("Sure, give some paracetamol and rest.")
    r = apply_gate("child with fever", parsed, {"transport": "now"}, "FEVER", "en", SECTIONS)
    assert r.action == "ASK_PERSON" and r.stm is None and r.overridden and "not sure" in r.body.lower()


def test_gate_no_guideline_abstains():
    parsed = parse_reply("ACTION: ADVISE\nSTM: NONE\n---\nTake two aspirin.")
    r = apply_gate("what is the capital of France", parsed, {"transport": "now"}, None, "en", SECTIONS)
    assert r.action == "ASK_PERSON" and r.stm is None and "no_guideline_abstain" in r.reasons


def test_gate_canonicalises_stm_and_limits_lines():
    body = "\n".join(f"line {i}" for i in range(12))
    parsed = parse_reply(f"ACTION: ADVISE\nSTM: malaria\n---\n{body}")
    r = apply_gate("child fever, RDT positive", parsed, {"transport": "now"}, "MALARIA", "en", SECTIONS)
    assert r.action == "ADVISE" and r.stm == "MALARIA" and not r.overridden
    assert len(r.body.splitlines()) <= 6
