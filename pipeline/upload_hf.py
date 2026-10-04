"""Upload Lokol Health GGUFs (and optionally LoRA adapters) to Hugging Face. SPEC §5: models live at VictorChenCA/lokol-*.

    .venv/bin/python pipeline/upload_hf.py --sizes 0.8B 2B --dry-run        # plan + manifest JSON, no network writes
    .venv/bin/python pipeline/upload_hf.py --sizes 0.8B 2B 9B               # real upload (token from ~/.cache/huggingface/token)
    .venv/bin/python pipeline/upload_hf.py --sizes 0.8B --include-f16 --adapters

Per size: repo VictorChenCA/lokol-health-<size>-gguf gets lokol-health-<size>-Q4_K_M.gguf (+ f16 with --include-f16) and a
model card; writes models/gguf/manifest-<size>.json ({url, sha256, size_mb, license}) for the pack manifest.
Also: --base uploads models/gguf/qwen3.5-0.8b-base-Q4_K_M.gguf to VictorChenCA/lokol-base-0.8b-gguf (runtime fallback).
"""
import argparse, hashlib, json, sys, time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
GGUF = ROOT / "models" / "gguf"
OWNER = "VictorChenCA"

def sha256(p, bufsize=1 << 24):
    h = hashlib.sha256()
    with open(p, "rb") as fh:
        while chunk := fh.read(bufsize):
            h.update(chunk)
    return h.hexdigest()

def model_card(size, files, base):
    rows = "\n".join(f"| `{f['name']}` | {f['quant']} | {f['size_mb']} MB | `{f['sha256'][:12]}…` |" for f in files)
    return f"""---
license: apache-2.0
base_model: {base}
language: [en, pis]
tags: [gguf, llama.cpp, qwen3.5, solomon-islands, pijin, health, lokol]
pipeline_tag: text-generation
---
# Lokol Health {size} (GGUF)

LoRA fine-tune of `{base}` for nurse aides in Solomon Islands, built with **Lokol Studio** for Hack-Nation #7 / World Bank
Challenge 04a (Small AI for Development, Health). The model follows the Solomon Islands Standard Treatment Manual for
Children (2017), answers in Solomon Islands Pijin or English, and uses a strict protocol:

```
ACTION: ADVISE | REFER_NOW | REFER_NEXT_TRANSPORT | ASK_PERSON
STM: <manual section> | NONE
---
<reply, at most 6 short lines>   (or one JSON visit-note object)
```
Inputs carry flags `[lang=pis|en] [rdt=…] [act=…] [transport=…]` and a retrieved `[guideline: …]` excerpt. The model never
diagnoses; a rule-based red-flag gate sits in front of it in every deployment.

| file | quant | size | sha256 |
|---|---|---|---|
{rows}

Run: `llama-server -m lokol-health-{size.lower()}-Q4_K_M.gguf --port 8080 --jinja` then POST `/v1/chat/completions` with
`"chat_template_kwargs": {{"enable_thinking": false}}`.

**Training data is synthetic** (teacher-generated from the manual; see the repo data card), not validated by native speakers,
and covers child primary care only. Not a medical device. Uploaded {time.strftime('%Y-%m-%d')}.
"""

def plan_size(size, include_f16, base):
    files = []
    for quant, suffix in [("Q4_K_M", "Q4_K_M"), ("F16", "f16")]:
        if quant == "F16" and not include_f16:
            continue
        p = GGUF / f"lokol-health-{size.lower()}-{suffix}.gguf"
        if not p.exists():
            print(f"  [skip] {p.relative_to(ROOT)} not found", file=sys.stderr)
            continue
        files.append({"path": p, "name": p.name, "quant": quant, "size_mb": round(p.stat().st_size / 1e6, 1), "sha256": sha256(p)})
    return files

def manifest(repo, files, base, size):
    return {"repo": repo, "base_model": base, "size": size, "license": "apache-2.0", "runtime": "wllama|llama-server",
            "models": [{"id": f"lokol-health-{size.lower()}-{f['quant']}", "file": f["name"],
                        "url": f"https://huggingface.co/{repo}/resolve/main/{f['name']}", "sha256": f["sha256"],
                        "size_mb": f["size_mb"], "license": "apache-2.0"} for f in files]}

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--sizes", nargs="*", default=["0.8B"])
    ap.add_argument("--include-f16", action="store_true")
    ap.add_argument("--adapters", action="store_true", help="also upload models/adapters/<size> to lokol-health-<size>-lora")
    ap.add_argument("--base", action="store_true", help="upload the base 0.8B Q4_K_M as VictorChenCA/lokol-base-0.8b-gguf")
    ap.add_argument("--private", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    from huggingface_hub import HfApi
    api = HfApi()
    try:
        who = api.whoami()["name"]
    except Exception as e:
        print(f"HF token problem ({e}); set HF_TOKEN or `hf auth login`", file=sys.stderr)
        if not a.dry_run: sys.exit(2)
        who = "?"
    print(f"hf user: {who}  dry_run={a.dry_run}")

    jobs = []  # (repo, [(local_path, path_in_repo)], readme_text, manifest_path, manifest_obj)
    for size in a.sizes:
        base = f"Qwen/Qwen3.5-{size}"
        files = plan_size(size, a.include_f16, base)
        if not files:
            continue
        repo = f"{OWNER}/lokol-health-{size.lower()}-gguf"
        m = manifest(repo, files, base, size)
        jobs.append((repo, [(f["path"], f["name"]) for f in files], model_card(size, files, base), GGUF / f"manifest-{size}.json", m))
        if a.adapters:
            ad = ROOT / "models" / "adapters" / size
            if (ad / "adapters.safetensors").exists():
                jobs.append((f"{OWNER}/lokol-health-{size.lower()}-lora", [(p, p.name) for p in ad.iterdir() if p.is_file() and not p.name.startswith(".")],
                             f"---\nlicense: apache-2.0\nbase_model: {base}\n---\n# Lokol Health {size} LoRA adapter (mlx-lm)\nSee {repo}.\n", None, None))
    if a.base:
        p = GGUF / "qwen3.5-0.8b-base-Q4_K_M.gguf"
        if p.exists():
            f = {"path": p, "name": p.name, "quant": "Q4_K_M", "size_mb": round(p.stat().st_size / 1e6, 1), "sha256": sha256(p)}
            repo = f"{OWNER}/lokol-base-0.8b-gguf"
            jobs.append((repo, [(p, p.name)], f"---\nlicense: apache-2.0\nbase_model: Qwen/Qwen3.5-0.8B\n---\n# Qwen3.5-0.8B base, Q4_K_M\nUntuned baseline for the Lokol Health eval and the runtime fallback. Quantized from ggml-org/Qwen3.5-0.8B-GGUF BF16.\n",
                         GGUF / "manifest-base-0.8B.json", manifest(repo, [f], "Qwen/Qwen3.5-0.8B", "base-0.8B")))

    if not jobs:
        print("nothing to upload (no GGUFs found under models/gguf)"); sys.exit(1)
    for repo, files, readme, mpath, mobj in jobs:
        total = sum(p.stat().st_size for p, _ in files) / 1e6
        print(f"\n== {repo}  ({len(files)} files, {total:.0f} MB){'  private' if a.private else ''}")
        for p, name in files:
            print(f"   {name}  {p.stat().st_size/1e6:.1f} MB")
        if mpath and mobj:
            mpath.write_text(json.dumps(mobj, indent=2))
            print(f"   manifest -> {mpath.relative_to(ROOT)}")
        if a.dry_run:
            continue
        api.create_repo(repo, repo_type="model", exist_ok=True, private=a.private)
        api.upload_file(path_or_fileobj=readme.encode(), path_in_repo="README.md", repo_id=repo, repo_type="model")
        for p, name in files:
            t0 = time.time()
            api.upload_file(path_or_fileobj=str(p), path_in_repo=name, repo_id=repo, repo_type="model")
            print(f"   uploaded {name} in {time.time()-t0:.0f}s")
        print(f"   https://huggingface.co/{repo}")
    print("\ndone" + (" (dry run: no network writes)" if a.dry_run else ""))

if __name__ == "__main__":
    main()
