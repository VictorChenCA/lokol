import pytest

from bridge.corpus import Chunk, chunk_raw_text, load_corpus
from bridge.config import settings
from bridge.retrieval import BM25, expand_query, guideline_line, tokenize

TINY = [
    Chunk("t-fever", "FEVER", "", 40, "Fever in a child. Take the temperature. Look for malaria with an RDT. Give paracetamol by weight.", 40),
    Chunk("t-malaria", "MALARIA", "Treatment", 53, "Malaria is caused by P. falciparum and P. vivax. Treat uncomplicated malaria with artemether-lumefantrine (AL) by weight. Severe malaria is an emergency, give artesunate and refer.", 60),
    Chunk("t-diarrhoea", "DIARRHOEA", "", 36, "Diarrhoea and dehydration. Watery stool. Assess dehydration: sunken eyes, skin pinch, drinking poorly. Give ORS and zinc.", 50),
    Chunk("t-pneumonia", "PNEUMONIA", "", 83, "Pneumonia: cough with fast breathing. Chest indrawing means severe pneumonia, give first dose amoxicillin and refer.", 50),
]


def test_tokenize_and_stem():
    assert "convuls" in tokenize("convulsions") or "convulsion" in tokenize("convulsions")
    assert "the" not in tokenize("the child")


def test_expand_query_pijin():
    q = expand_query("pikinini hot bodi an sitsit wata")
    assert "fever" in q and "child" in q and "diarrhoea" in q


def test_bm25_tiny_english():
    idx = BM25(TINY)
    hits = idx.search("malaria positive, treatment for uncomplicated malaria, artemether", 2)
    assert hits and hits[0].chunk.section == "MALARIA"
    assert idx.search("child has a fever, take the temperature", 1)[0].chunk.section == "FEVER"


def test_bm25_tiny_pijin():
    idx = BM25(TINY)
    assert idx.search("pikinini sitsit wata, ai go insaet", 1)[0].chunk.section == "DIARRHOEA"
    assert idx.search("brit hariap an kof", 1)[0].chunk.section == "PNEUMONIA"


def test_bm25_no_hits_for_junk():
    idx = BM25(TINY)
    assert idx.search("quarterly revenue forecast spreadsheet", 3) == []


def test_guideline_line_format():
    line = guideline_line(TINY[1], max_words=10)
    assert line.startswith("[guideline: MALARIA p53] Malaria is caused by")
    assert guideline_line(None) == "[guideline: none] none"


@pytest.mark.skipif(not settings.raw_txt.exists(), reason="raw STM text not present (gitignored)")
def test_fallback_chunker_on_raw_text():
    chunks = chunk_raw_text(settings.raw_txt)
    assert len(chunks) >= 100
    sections = {c.section for c in chunks}
    assert "MALARIA" in sections and "PNEUMONIA" in sections and "DIARRHOEA" in sections
    assert all(c.text and c.page > 0 for c in chunks)


@pytest.mark.skipif(not (settings.corpus_jsonl.exists() or settings.raw_txt.exists()), reason="no corpus")
def test_real_corpus_retrieval():
    chunks, sections, source = load_corpus()
    idx = BM25(chunks)
    assert idx.search("child with fever for 2 days, RDT positive, what to give", 1)[0].chunk.section == "MALARIA"
    top = idx.search("sitsit wata 3 dei, ai go insaet", 1)[0]
    assert top.chunk.section.startswith("DIARRHOEA") and top.score >= settings.min_retrieval_score
    junk = idx.search("adult man with chest pain", 1)
    assert not junk or junk[0].score < settings.min_retrieval_score
