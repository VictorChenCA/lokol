"""Dose-grounding guard. The parametrised cases live in app/src/runtime/tests/doseguard_cases.json and
are shared with the app's bun runner, so the bridge and the phone app are held to the same answers."""

import json
from pathlib import Path

import pytest

from bridge.doseguard import extract_doses, guard_doses
from bridge.gate import apply_gate, parse_reply

ROOT = Path(__file__).resolve().parents[2]
CASES = json.loads((ROOT / "app/src/runtime/tests/doseguard_cases.json").read_text())
SECTIONS = ["FEVER", "MALARIA", "CONVULSIONS", "LYMPHADENOPATHY"]
CONV = CASES[0]["excerpt"]
FEVER = CASES[1]["excerpt"]


@pytest.mark.parametrize("c", CASES, ids=[c["name"] for c in CASES])
def test_shared_cases(c):
    body, bad = guard_doses(c["body"], c["excerpt"], c["message"], c["page"], c["lang"])
    assert body == (c["expect_body"] if c["expect_body"] is not None else c["body"])
    assert bad == c["expect_unsupported"]


def _units(s):
    return [f"{d.lo:g}-{d.hi:g} {d.unit}" for d in extract_doses(s)]


def test_non_doses_not_extracted():
    assert _units("3 days, 2 years, 38.5 C, p53, 12 kg, 13 kilo, 5 good, 2 units") == []


def test_units_normalised():
    assert _units("10 mcg/kg, 2.5mL, 1,000 mg, 50 units/kg, 2 IU, 1 g/kg") == [
        "10-10 mcg/kg", "2.5-2.5 ml", "1000-1000 mg", "50-50 units/kg", "2-2 iu", "1-1 g/kg"]


def test_gate_replaces_midazolam_and_keeps_action():
    parsed = parse_reply("ACTION: REFER_NOW\nSTM: CONVULSIONS\n---\nGive midazolam 20 mg/kg rectally.\nRefer to hospital now.")
    r = apply_gate("child fitting for 10 minutes, 12 kg", parsed, {"transport": "now"}, "CONVULSIONS", "en", SECTIONS, excerpt=CONV, page=34)
    assert r.action == "REFER_NOW" and r.overridden
    assert "20 mg/kg" not in r.body and "manual page 34" in r.body
    assert "unsupported_dose:20 mg/kg" in r.reasons


def test_gate_keeps_grounded_weight_dose():
    parsed = parse_reply("ACTION: ADVISE\nSTM: FEVER\n---\nGivim paracetamol 195 mg evri 6 aoa.\nKambak long 2 dei.")
    r = apply_gate("Pikinini 3 yia, 13 kg, hot bodi 2 dei", parsed, {"transport": "next_boat"}, "FEVER", "pis", SECTIONS, excerpt=FEVER, page=40)
    assert r.action == "ADVISE" and not r.overridden and "195 mg" in r.body and r.reasons == []


def test_gate_pijin_unsupported_dose():
    parsed = parse_reply("ACTION: ADVISE\nSTM: FEVER\n---\nGivim paracetamol 30 mg/kg IV.\nKambak long 2 dei.")
    r = apply_gate("Pikinini 3 yia, hot bodi 2 dei", parsed, {"transport": "next_boat"}, "FEVER", "pis", SECTIONS, excerpt=FEVER, page=40)
    assert r.action == "ADVISE" and r.overridden
    assert r.body.startswith("Dos: lukim buk STM pej 40") and "Kambak" in r.body


def test_gate_without_excerpt_uses_ask_person_dose_line():
    parsed = parse_reply("ACTION: REFER_NOW\nSTM: CONVULSIONS\n---\nGive midazolam 20 mg/kg rectally.\nRefer to hospital now.")
    r = apply_gate("child fitting now", parsed, {"transport": "now"}, "CONVULSIONS", "en", SECTIONS)
    assert r.action == "REFER_NOW" and "Dose: ask the nurse in charge or the doctor." in r.body and "20 mg/kg" not in r.body


def test_gate_red_flag_reason_and_dose_reason():
    parsed = parse_reply("ACTION: REFER_NOW\nSTM: FEVER\n---\nGive paracetamol 40 mg/kg.\nRefer now.")
    r = apply_gate("child with fever and a convulsion", parsed, {"transport": "now"}, "FEVER", "en", SECTIONS, excerpt=FEVER, page=40)
    assert r.action == "REFER_NOW" and r.overridden and "40 mg" not in r.body
    assert "unsupported_dose:40 mg/kg" in r.reasons


def test_gate_skips_json_note():
    parsed = parse_reply('ACTION: ADVISE\nSTM: FEVER\n---\n{"drugs":[{"name":"paracetamol","dose":"195 mg"}]}')
    r = apply_gate("visit note, 13 kg, gave paracetamol 195 mg", parsed, {"transport": "now"}, "FEVER", "en", SECTIONS, excerpt="nothing", page=40)
    assert r.body.startswith("{") and "195 mg" in r.body
