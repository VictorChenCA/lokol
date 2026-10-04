import tempfile
from pathlib import Path

from bridge.state import StateStore, handle_command


def _store():
    return StateStore(Path(tempfile.mkdtemp()) / "users.json")


def test_defaults_and_flags():
    store = _store()
    st = store.get("whatsapp", "u1")
    assert st.rdt == "unknown" and st.act == "unknown" and st.transport == "now" and st.lang == "auto"
    assert st.flags("pis") == {"lang": "pis", "rdt": "unknown", "act": "unknown", "transport": "now"}


def test_commands_set_flags():
    store = _store()
    st = store.get("whatsapp", "u2")
    assert handle_command(store, st, "/rdt no") is not None and st.rdt == "no"
    assert handle_command(store, st, "/act yes") is not None and st.act == "yes"
    handle_command(store, st, "/boat")
    assert st.transport == "next_boat"
    handle_command(store, st, "/now")
    assert st.transport == "now"
    handle_command(store, st, "/notransport")
    assert st.transport == "none"
    handle_command(store, st, "/lang pis")
    assert st.lang == "pis"
    handle_command(store, st, "/voice on")
    assert st.voice is True
    # persisted and reloadable
    again = StateStore(store.path).get("whatsapp", "u2")
    assert again.rdt == "no" and again.transport == "none" and again.lang == "pis"


def test_non_command_returns_none():
    store = _store()
    st = store.get("http", "u3")
    assert handle_command(store, st, "child with fever") is None


def test_invalid_values_get_usage():
    store = _store()
    st = store.get("http", "u4")
    assert handle_command(store, st, "/rdt maybe") == "/rdt yes|no|unknown"
    assert st.rdt == "unknown"


def test_help_and_status_and_reset():
    store = _store()
    st = store.get("http", "u5")
    assert "Lokol Health" in handle_command(store, st, "/help")
    handle_command(store, st, "/rdt yes")
    assert "RDT=yes" in handle_command(store, st, "/status")
    handle_command(store, st, "/reset")
    assert st.rdt == "unknown"
