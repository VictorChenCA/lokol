"""Pure-Python BM25 retrieval over the STM chunks, with a Pijin -> English query expansion so a
nurse writing "hot bodi" still lands on the FEVER / MALARIA pages."""

from __future__ import annotations

import math
import re
from collections import Counter
from dataclasses import dataclass

from .corpus import Chunk

_TOKEN = re.compile(r"[a-z0-9]+")

STOPWORDS = {
    "the", "a", "an", "and", "or", "of", "to", "in", "on", "for", "with", "is", "are", "was", "be",
    "it", "this", "that", "at", "by", "as", "if", "not", "no", "but", "from", "than", "then", "so",
    "has", "have", "had", "do", "does", "did", "can", "may", "should", "will", "he", "she", "they",
    "his", "her", "their", "we", "you", "i", "me", "my", "our", "your", "what", "which", "who",
    "when", "where", "how", "all", "any", "some", "very", "also", "into", "over", "per", "about",
    # Pijin function words
    "hem", "hemi", "long", "blong", "bilong", "olketa", "mi", "iu", "mifala", "iufala", "nao", "ya",
    "ia", "wanem", "olsem", "fo", "wetem", "nomoa", "bae", "bai", "stap", "go", "kam", "insaet",
    "disfala", "datfala", "wan", "tu", "tri", "finis", "pinis", "plis", "tanggio", "save", "savve",
}

# Phrases first (longest match), then single tokens. Values are English index terms.
PIJIN_PHRASES: dict[str, list[str]] = {
    "hot bodi": ["fever", "temperature"],
    "hot body": ["fever"],
    "bodi hot": ["fever"],
    "sitsit wata": ["diarrhoea", "stool", "dehydration"],
    "sitsit blad": ["dysentery", "blood", "stool"],
    "nek stif": ["stiff", "neck", "meningitis"],
    "stif nek": ["stiff", "neck", "meningitis"],
    "slip tumas": ["lethargic", "drowsy"],
    "sot win": ["breathing", "difficulty", "pneumonia"],
    "sek sek": ["convulsion", "seizure"],
    "sek-sek": ["convulsion", "seizure"],
    "no save dring": ["unable", "drink", "danger"],
    "no save susu": ["unable", "breastfeed", "danger"],
    "no save kaikai": ["unable", "eat", "feed"],
    "brit hariap": ["fast", "breathing", "pneumonia"],
    "hariap brit": ["fast", "breathing", "pneumonia"],
    "soa long skin": ["skin", "sore", "infection"],
    "skin soa": ["skin", "sore", "infection"],
    "pen long ia": ["ear", "pain", "otitis"],
    "ia soa": ["ear", "otitis"],
    "ai soa": ["eye", "conjunctivitis"],
    "bel pen": ["abdominal", "pain"],
    "bele pen": ["abdominal", "pain"],
    "bon tumas": ["wasting", "malnutrition"],
    "tin tumas": ["thin", "malnutrition"],
    "leg swel": ["oedema", "feet", "malnutrition"],
}

PIJIN_TOKENS: dict[str, list[str]] = {
    "pikinini": ["child"], "pikinin": ["child"], "bebi": ["baby", "infant"], "sik": ["sick", "illness"],
    "meresin": ["medicine", "drug"], "dokta": ["doctor"], "nes": ["nurse"], "klinik": ["clinic"],
    "hospitol": ["hospital"], "wata": ["water", "fluid"], "kaikai": ["food", "feeding"],
    "susu": ["breast", "breastfeeding", "milk"], "toraot": ["vomit", "vomiting"], "toraotem": ["vomit"],
    "sitsit": ["diarrhoea", "stool"], "brit": ["breathing", "breath"], "fit": ["convulsion", "seizure"],
    "seksek": ["convulsion"], "slip": ["lethargic", "sleepy"], "nek": ["neck"], "stif": ["stiff"],
    "blad": ["blood", "bleeding"], "hariap": ["fast"], "kwiktaem": ["quickly", "urgent"],
    "bot": ["boat", "transport", "referral"], "sendem": ["refer", "referral"], "lukim": ["check", "examine"],
    "givim": ["give"], "kof": ["cough"], "kus": ["cough"], "sotwin": ["breathing", "difficulty"],
    "soa": ["sore", "wound", "ulcer"], "swel": ["swelling", "oedema"], "hed": ["head"],
    "hedek": ["headache"], "bel": ["abdomen", "stomach"], "bele": ["abdomen"], "ded": ["unconscious"],
    "dae": ["death"], "pispis": ["urine"], "skrasim": ["itch", "scabies"], "skras": ["itch", "scabies"],
    "bon": ["burn"], "bonem": ["burn"], "poisen": ["poisoning", "poison"], "wom": ["worm"],
    "wokabaot": ["walk"], "mosquito": ["mosquito", "malaria"], "moskito": ["mosquito", "malaria"],
    "bonbon": ["bone"], "tis": ["teeth", "tooth"], "fes": ["face"], "maot": ["mouth"], "nus": ["nose"],
    "ai": ["eye"], "han": ["hand", "arm"], "leg": ["leg", "feet"], "skin": ["skin"], "mama": ["mother"],
    "dring": ["drink", "fluid"], "dringim": ["drink"], "nila": ["injection"], "sut": ["injection", "vaccine"],
    "wik": ["week"], "mun": ["month"], "manis": ["month"], "yia": ["year"], "dei": ["day"],
    "fiva": ["fever"], "mit": ["measles"], "misels": ["measles"], "yelo": ["jaundice", "yellow"],
    "hat": ["heart"], "shivaring": ["rigors", "shivering"], "kolsik": ["cold", "cough"],
    "pen": ["pain"], "krae": ["cry", "irritable"], "weit": ["weight"], "smol": ["small", "low"],
    "tin": ["thin", "wasting"], "drae": ["dry", "dehydration"],
}


# English symptom phrases -> the STM chapter that owns them (steers BM25 toward the right section).
EN_PHRASES: dict[str, list[str]] = {
    "fast breathing": ["pneumonia"],
    "chest indrawing": ["pneumonia", "severe"],
    "difficulty breathing": ["pneumonia", "asthma"],
    "wheez": ["asthma"],
    "stiff neck": ["meningitis"],
    "bulging fontanel": ["meningitis"],
    "convuls": ["convulsions"],
    "seizure": ["convulsions"],
    "fitting": ["convulsions"],
    "watery stool": ["diarrhoea", "dehydration"],
    "loose stool": ["diarrhoea"],
    "blood in stool": ["dysentery", "diarrhoea"],
    "sunken eyes": ["dehydration", "diarrhoea"],
    "swollen feet": ["malnutrition", "oedema"],
    "both feet": ["malnutrition", "oedema"],
    "wasting": ["malnutrition"],
    "very thin": ["malnutrition"],
    "not gaining weight": ["malnutrition"],
    "rash": ["measles", "skin"],
    "burn": ["burns", "scalds"],
    "scald": ["burns"],
    "ear discharge": ["otitis", "media"],
    "ear pain": ["otitis", "media"],
    "sore throat": ["colds", "urti"],
    "runny nose": ["colds", "urti"],
    "whoop": ["pertussis"],
    "cough for": ["tuberculosis", "pneumonia"],
    "yellow": ["jaundice", "newborn"],
    "jaundice": ["jaundice", "newborn"],
    "umbilic": ["newborn", "infections"],
    "poison": ["poisoning"],
    "swallowed": ["poisoning"],
    "kerosene": ["poisoning"],
    "worm": ["worm", "parasitic"],
    "scabies": ["skin", "diseases"],
    "sores": ["skin", "diseases"],
    "pale": ["anaemia"],
    "pass urine": ["urinary", "tract", "infection"],
    "painful urination": ["urinary", "tract", "infection"],
    "joint pain": ["rheumatic", "fever", "septic", "arthritis"],
    "vaccine": ["immunisation"],
    "immuniz": ["immunisation"],
    "low sugar": ["hypoglycaemia"],
    "not breathing": ["resuscitation"],
    "dose": ["drug", "doses"],
    "how much": ["drug", "doses"],
}


def _stem(tok: str) -> str:
    if len(tok) > 5 and tok.endswith("ies"):
        return tok[:-3] + "y"
    if len(tok) > 5 and tok.endswith("ing"):
        return tok[:-3]
    if len(tok) > 4 and tok.endswith("es"):
        return tok[:-2]
    if len(tok) > 3 and tok.endswith("s") and not tok.endswith("ss"):
        return tok[:-1]
    return tok


def tokenize(text: str) -> list[str]:
    text = text.lower().replace("’", "'")
    # spelling normalisation that helps both languages
    text = text.replace("diarrhea", "diarrhoea").replace("oedema", "oedema").replace("edema", "oedema")
    return [_stem(t) for t in _TOKEN.findall(text) if t not in STOPWORDS and len(t) > 1]


def expand_query(text: str) -> list[str]:
    """Tokenise the query and add English index terms for Pijin words/phrases."""
    low = text.lower()
    extra: list[str] = []
    for phrase, terms in PIJIN_PHRASES.items():
        if phrase in low:
            extra.extend(terms)
    for phrase, terms in EN_PHRASES.items():
        if phrase in low:
            extra.extend(terms)
    toks = _TOKEN.findall(low)
    for t in toks:
        if t in PIJIN_TOKENS:
            extra.extend(PIJIN_TOKENS[t])
    base = tokenize(text)
    return base + [_stem(t) for t in extra]


@dataclass
class Hit:
    chunk: Chunk
    score: float


class BM25:
    def __init__(self, chunks: list[Chunk], k1: float = 1.5, b: float = 0.75) -> None:
        self.chunks = chunks
        self.k1, self.b = k1, b
        self.docs: list[Counter[str]] = []
        self.doc_len: list[int] = []
        df: Counter[str] = Counter()
        for c in chunks:
            # Section title counts extra so "malaria" prefers the MALARIA chapter pages.
            toks = tokenize(c.text) + tokenize(c.section) * 3 + tokenize(c.subsection)
            cnt = Counter(toks)
            self.docs.append(cnt)
            self.doc_len.append(len(toks))
            df.update(cnt.keys())
        self.n = len(chunks)
        self.avgdl = (sum(self.doc_len) / self.n) if self.n else 0.0
        self.idf = {t: math.log(1 + (self.n - n + 0.5) / (n + 0.5)) for t, n in df.items()}

    def score(self, q: list[str], i: int) -> float:
        cnt = self.docs[i]
        dl = self.doc_len[i]
        s = 0.0
        for t in q:
            f = cnt.get(t)
            if not f:
                continue
            idf = self.idf.get(t, 0.0)
            s += idf * (f * (self.k1 + 1)) / (f + self.k1 * (1 - self.b + self.b * dl / (self.avgdl or 1)))
        return s

    def search(self, query: str, k: int = 3) -> list[Hit]:
        q = expand_query(query)
        if not q or not self.n:
            return []
        scored = [(self.score(q, i), i) for i in range(self.n)]
        scored.sort(key=lambda x: -x[0])
        return [Hit(self.chunks[i], s) for s, i in scored[:k] if s > 0]


def guideline_line(chunk: Chunk | None, max_words: int = 240) -> str:
    """The `[guideline: SECTION pNN] <excerpt>` line of the user turn (SPEC §2). ~240 words ≈ 350 tokens."""
    if chunk is None:
        return "[guideline: none] none"
    words = chunk.text.split()
    excerpt = " ".join(words[:max_words])
    excerpt = re.sub(r"\s+", " ", excerpt).strip()
    return f"[guideline: {chunk.section} p{chunk.page}] {excerpt}"
