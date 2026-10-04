"""Build the drug lexicon the dose guard uses to bind a dose to its drug (bridge/doseguard.py, app/src/runtime/doseguard.ts).

    .venv/bin/python pipeline/build_drug_lexicon.py

Writes the SAME JSON to app/src/runtime/drug_lexicon.json and bridge/drug_lexicon.json:
  stop      words that are never a drug word (English + Pijin verbs, routes, units, forms, time words, fillers).
            Kept here so both guards read one list.
  words     (v2 candidates) every whole word (letters only, >= 4 long, lowercased, not a stop word) that ends within 40 characters
            before a number+unit dose anywhere in corpus/stm_children_chunks.jsonl (the PAEDIATRIC DRUG DOSES,
            DRUG DOSING TABLE and NEWBORN DRUG DOSES pages and every other page). Noisy on purpose: it is used to
            accept a drug word written to the RIGHT of a dose ("15 mg/kg of paracetamol"), never to reject one.
  drugs     (v3, what the guard uses) the CURATED medicine list: groups of names for one medicine (generic names,
            the manual's own misspellings, Pijin spellings, brands, multi-word or hyphenated names). Built from the
            corpus candidates above, keeping only real medicines (MEDICINE_CANDIDATES below; non-drugs such as fever,
            hospital, refer, very, neonate, infant, oxygen, saline, antibiotic are left out), plus WHO essential medicines
            for children and common brands. The first name of a group is its canonical name; any member binds to any other.
  unknown_suffixes / not_drugs
            a word that is not a curated name but ends in one of these suffixes (and is 6+ letters and not in not_drugs)
            is an UNKNOWN DRUG: a dose bound to it is unsupported.
"""
import json, re, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from bridge.doseguard import DOSE_RE, _clean  # noqa: E402  (same dose regex and normalisation as the guard)

STOP = sorted(set("""
give givim givem giv gives given giving take tekem tek takes taking then every evri dose dos doses dosage dosing
start stat use iusim usim using with wetem of blong long a an the and o or mo per fo for max maximum up to at once
twice daily oral orally iv im pr po rectal rectally by mouth maot tablet tablets tab tabs capsule capsules syrup
liquid injection injections ml mg kg
mgs milligram milligrams milligramme milligrammes mcg mcgs microgram micrograms microgramme microgrammes gram grams
gramme grammes gms mls millilitre millilitres milliliter milliliters unit units iu kgs kilo kilos kilogram kilograms
then after before each more than less about approx approximately around total only also until over into from
hour hours hourly aoa day days dei week weeks month months year years yia time times taem now nao
weight weighs weighing child children pikinini baby bebi patient
loading maintenance initial starting single divided slow slowly deep push bolus infusion stat first fes next nekis
plus extra repeat again continue dilute diluted mix make draw add
solution mixture suspension drops elixir suppository suppositories supp supps ampoule ampoules vial vials sachet
sachets packet packets medicine medicines medisin meresin marasin medication drug drugs
intramuscular intramuscularly intravenous intravenously buccal intranasal nebulised nebulized subcutaneous sublingual
botom
should must will need needs please always never sapos then follow folom according based
which that this these those there here what when where whichever equals equal makes comes gives contains containing
exceed exceeding pass winim kasem nomoa wanfala olsem diswan ating bihaen fastaem firstaem mekem evriwan olketa olgeta
samting gudfala tumas liklik smol bigfala stap statim statem stretem
fluid fluids volume rate feed feeds water wata
bifo boat bot minit minute minutes mins inject injected concentration available unavailable
calculation calculated calculate guideline guidelines manual page book buk states says formula since like proper gave
talem them they their receive receiving normal half round rounded check decision drink dring kaikai
""".split()))

# Curated medicines (v3). One list per medicine: canonical name first, then synonyms, the manual's misspellings, Pijin
# spellings and brands. Multi-word and hyphenated names match as consecutive words. Fluids other than ORS/glucose
# (saline, Hartmann's), oxygen and drug classes ("antibiotic", "steroids") are deliberately NOT medicines here.
DRUGS = [
    # antimalarials
    ["artemether-lumefantrine", "artemether lumefantrine", "coartem", "co-artem", "co-artam", "al", "artemether", "lumefantrine"],
    ["artesunate", "artesunat"],
    ["quinine"],
    ["primaquine"],
    ["chloroquine"],
    ["sulfadoxine-pyrimethamine", "sulfadoxine pyrimethamine", "fansidar", "sulfadoxine", "pyrimethamine"],
    # penicillins and other antibiotics
    ["amoxycillin", "amoxicillin", "amoxyl", "amoxil", "amoksilin"],
    ["amoxicillin-clavulanate", "amoxicillin clavulanate", "amoxycillin clavulanate", "amoxicillin clavulanic acid",
     "amoxycillin clavulanic acid", "co-amoxiclav", "amoxiclav", "augmentin", "clavulanic acid", "clavulanate", "clavulanic"],
    ["ampicillin"],
    ["benzylpenicillin", "benzyl penicillin", "crystalline penicillin", "penicillin g", "benpen"],
    ["procaine penicillin", "procaine benzylpenicillin", "procaine"],
    ["benzathine penicillin", "benzathine benzylpenicillin", "benzathine", "bicillin"],
    ["phenoxymethylpenicillin", "penicillin v", "pen v"],
    ["penicillin"],
    ["cloxacillin", "flucloxacillin", "kloxacillin", "floxapen"],
    ["gentamicin", "gentamycin"],
    ["ceftriaxone", "rocephin"],
    ["cefotaxime", "claforan"],
    ["cefazolin", "cephazolin"],
    ["cephalexin", "cefalexin", "keflex"],
    ["chloramphenicol", "chlormenphenicol", "chloramphenic", "chlormenphenico", "chloromycetin"],
    ["erythromycin"],
    ["azithromycin", "zithromax"],
    ["co-trimoxazole", "cotrimoxazole", "trimethoprim", "sulfamethoxazole", "sulphamethoxazole", "trimoxazole", "bactrim", "septrin"],
    ["metronidazole", "flagyl"],
    ["tinidazole", "tinadazole"],
    ["ciprofloxacin", "ciprofloxaxin", "cipro"],
    ["nitrofurantoin"],
    ["doxycycline"],
    ["tetracycline"],
    ["clindamycin"],
    ["vancomycin"],
    # TB
    ["isoniazid", "inh"],
    ["rifampicin", "rifampin"],
    ["pyrazinamide"],
    ["ethambutol", "ethambutamol"],
    # analgesics
    ["paracetamol", "panadol", "acetaminophen", "parasetamol", "tylenol", "calpol"],
    ["ibuprofen", "nurofen", "brufen", "advil", "motrin"],
    ["aspirin"],
    ["ketorolac", "toradol"],
    ["codeine"],
    ["tramadol"],
    ["morphine"],
    ["pethidine"],
    ["ketamine"],
    ["naloxone", "narcan"],
    ["lignocaine", "lidocaine"],
    # anticonvulsants, sedatives
    ["diazepam", "diazapam", "valium"],
    ["midazolam", "hypnovel"],
    ["phenobarbitone", "phenobarbital", "phenobarbiton", "phenobarb", "luminal"],
    ["phenytoin", "dilantin", "epanutin"],
    ["sodium valproate", "valproate", "valproic acid", "epilim"],
    ["carbamazepine", "tegretol"],
    ["chlorpromazine", "largactil"],
    ["promethazine", "phenergan"],
    # respiratory, steroids
    ["salbutamol", "ventolin", "albuterol"],
    ["aminophylline"],
    ["beclomethasone", "beclometasone"],
    ["prednisolone"],
    ["hydrocortisone"],
    ["dexamethasone", "dexamethsone"],
    ["adrenaline", "epinephrine"],
    # nutrition, fluids
    ["zinc", "zinc sulphate", "zinc sulfate"],
    ["ors", "oral rehydration", "oral rehydration solution", "oral rehydration salts", "resomal"],
    ["vitamin a", "retinol"],
    ["vitamin k", "phytomenadione", "phytonadione"],
    ["ferrous sulphate", "ferrous", "iron"],
    ["folic acid", "folate"],
    ["multivitamin"],
    ["glucose", "dextrose"],
    ["sodium bicarbonate", "bicarbonate"],
    ["potassium citrate"],
    ["magnesium sulphate", "magnesium sulfate", "magnesium", "mgso"],
    # worms, fungi, viruses
    ["albendazole", "zentel"],
    ["mebendazole", "vermox"],
    ["ivermectin"],
    ["nystatin"],
    ["miconazole", "daktarin"],
    ["clotrimazole"],
    ["ketoconazole"],
    ["fluconazole", "diflucan"],
    ["griseofulvin"],
    ["terbinafine"],
    ["acyclovir", "aciclovir", "zovirax"],
    ["chlorhexidine"],
    # other
    ["oxytocin"],
    ["insulin"],
    ["frusemide", "furosemide", "fruesemide", "lasix"],
    ["spironolactone"],
    ["digoxin"],
    ["enalapril"],
    ["captopril"],
    ["nifedipine"],
    ["amlodipine"],
    ["metoclopramide", "maxolon"],
    ["ondansetron"],
    ["ranitidine"],
    ["omeprazole"],
    ["caffeine", "cafeine", "caffeine citrate"],
]

# Corpus candidates (words_near_doses) judged to be medicines. Every one must be a DRUGS name; all other candidates
# (fever, hospital, refer, very, neonate, infant, oxygen, antibiotic, ...) are rejected as non-drugs.
MEDICINE_CANDIDATES = """
acyclovir adrenaline albendazole aminophylline amoxycillin amoxyl ampicillin ampicillinv artemether artesunate aspirin
azithromycin beclomethasone benzathine benzylpenicillin bicarbonate cafeine carbamazepine cefazolin cefotaxime
ceftriaxone chloramphenic chloramphenicol chlorhexidine chlormenphenico chloroquine chlorpromazine ciprofloxacin
ciprofloxaxin clavulanate clavulanic cloxacillin codeine dexamethasone dexamethsone dextrose diazapam diazepam digoxin
enalapril erythromycin ethambutamol ferrous fruesemide frusemide gentamicin glucose griseofulvin hydrocortisone
ibuprofen iron isoniazid ivermectin ketamine lignocaine lumefantrine magnesium metoclopramide metronidazole mgso
midazolam morphine multivitamin naloxone nifedipine nystatin paracetamol penicillin pethidine phenobarbiton
phenobarbitone phenytoin phytomenadione prednisolone primaquine procaine promethazine pyrazinamide quinine ranitidine
resomal rifampicin salbutamol spironolactone sulfamethoxazole terbinafine tinidazole trimethoprim trimoxazole valproate
zinc
""".split()

# UNKNOWN DRUG: a 6+ letter word that is not a curated name but ends in one of these. not_drugs are English words
# that end the same way.
UNKNOWN_SUFFIXES = ["cillin", "mycin", "micin", "azole", "olac", "oxacin", "cycline", "pril", "olol", "statin", "sone",
                    "lone", "pam", "lam", "tine", "done", "dine", "mab", "vir", "fen", "profen", "pine",
                    "penem", "xime", "idime", "epime", "racetam"]  # carbapenems, cephalosporins (cefuroxime, ceftazidime, cefepime), levetiracetam
NOT_DRUGS = ["routine", "routines", "intestine", "intestines", "quarantine", "pristine", "valentine", "dentine",
             "sardine", "sardines", "condone", "cyclone", "cyclones", "alpine", "supine", "spine", "opine", "porcupine"]


def words_near_doses() -> list[str]:
    out = set()
    for line in open(ROOT / "corpus/stm_children_chunks.jsonl"):
        t = re.sub(r"[ \t\n\r\f\v]+", " ", _clean(json.loads(line)["text"]))
        for m in DOSE_RE.finditer(t):
            s = m.start(2)
            for w in re.finditer(r"[A-Za-z]+", t[max(0, s - 40):s]):
                if w.start() == 0 and s - 40 > 0 and t[s - 41].isalpha():
                    continue  # cut in half by the 40-character window: not a whole word
                lw = w.group().lower()
                if len(lw) >= 4 and lw not in STOP:
                    out.add(lw)
    return sorted(out)


def _key(name: str) -> str:
    return " ".join(w.lower() for w in re.findall(r"[A-Za-z]+", name))


def _edit1(a: str, b: str) -> bool:
    """Levenshtein distance <= 2 (used only to report near-collisions between different medicines)."""
    if abs(len(a) - len(b)) > 2:
        return False
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1] <= 2


def check_drugs(words: list[str]) -> None:
    owner: dict[str, int] = {}
    for gi, g in enumerate(DRUGS):
        for n in g:
            k = _key(n)
            assert owner.get(k, gi) == gi, f"{n!r} is in two drug groups"
            owner[k] = gi
    missing = [w for w in MEDICINE_CANDIDATES if w != "ampicillinv" and w not in owner]
    assert not missing, f"medicine candidates missing from DRUGS: {missing}"
    rejected = [w for w in words if w not in MEDICINE_CANDIDATES]
    print(f"corpus candidates: {len(words)}; kept as medicines: {len(MEDICINE_CANDIDATES)}; rejected as non-drugs: {len(rejected)}")
    singles = [(k, gi) for k, gi in owner.items() if " " not in k and len(k) >= 7]
    for i, (a, ga) in enumerate(singles):
        for b, gb in singles[i + 1:]:
            if ga != gb and _edit1(a, b):
                print(f"WARNING: {a!r} and {b!r} are within 2 edits but different medicines")


def main():
    words = words_near_doses()
    check_drugs(words)
    lex = {"_about": "Generated by pipeline/build_drug_lexicon.py from corpus/stm_children_chunks.jsonl; do not edit by hand.",
           "stop": STOP, "words": words, "drugs": DRUGS, "unknown_suffixes": UNKNOWN_SUFFIXES, "not_drugs": NOT_DRUGS}
    text = json.dumps(lex, ensure_ascii=False, indent=1) + "\n"
    for p in (ROOT / "app/src/runtime/drug_lexicon.json", ROOT / "bridge/drug_lexicon.json"):
        p.write_text(text)
    print(f"stop={len(STOP)} words={len(words)} drugs={len(DRUGS)} groups / {sum(map(len, DRUGS))} names"
          " -> app/src/runtime/drug_lexicon.json, bridge/drug_lexicon.json")


if __name__ == "__main__":
    main()
