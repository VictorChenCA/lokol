"""River LoRA (Qwen3.5-9B, fused in_proj_qkvz) -> llama.cpp GGUF LoRA.

River trains Qwen3.5's linear-attention input projection as one fused module (in_proj_qkvz = [q; k; v] rows then [z] rows).
llama.cpp's converter only maps the split HF names (in_proj_qkv, in_proj_z) for Qwen3.5 and re-orders V heads itself, so we split
the adapter's B matrix by rows (A is shared) and then run convert_lora_to_gguf.py against the base config.

    .venv/bin/python pipeline/river_lora_to_gguf.py models/river/lokol-health-9b/adapter models/gguf/lokol-health-9b-lora-f16.gguf
    llama-server -m Qwen3.5-9B-Q4_K_M.gguf --lora models/gguf/lokol-health-9b-lora-f16.gguf --jinja -c 4096

Verified on 30 held-out cases: format 93%, action 83%, citation 83% (River-hosted: 97 / 87 / 87 on 300).
"""
import json, os, subprocess, sys
from pathlib import Path

from safetensors.torch import load_file, save_file

LLAMA_CPP = os.environ.get("LLAMA_CPP", "/private/tmp/claude-501/-Users-victor/337b8ded-3ecd-4ec9-9077-6582ecbf0a2d/scratchpad/llama.cpp")


def split_qkvz(src: Path, dst: Path, cfg_path: Path) -> int:
    c = json.load(open(cfg_path))
    c = c.get("text_config", c)
    hk, nk = c["linear_key_head_dim"], c["linear_num_key_heads"]
    hv, nv = c["linear_value_head_dim"], c["linear_num_value_heads"]
    qkv_rows, z_rows = 2 * nk * hk + nv * hv, nv * hv
    t, out, n = load_file(src / "adapter_model.safetensors"), {}, 0
    for k, v in t.items():
        if ".in_proj_qkvz." not in k:
            out[k] = v
            continue
        q, z = k.replace(".in_proj_qkvz.", ".in_proj_qkv."), k.replace(".in_proj_qkvz.", ".in_proj_z.")
        if k.endswith("lora_A.weight"):
            out[q], out[z] = v.clone(), v.clone()
        else:
            assert v.shape[0] == qkv_rows + z_rows, (k, v.shape)
            out[q], out[z] = v[:qkv_rows].contiguous(), v[qkv_rows:].contiguous()
            n += 1
    dst.mkdir(parents=True, exist_ok=True)
    save_file(out, dst / "adapter_model.safetensors")
    a = json.load(open(src / "adapter_config.json"))
    a["target_modules"] = sorted([m for m in a["target_modules"] if m != "in_proj_qkvz"] + ["in_proj_qkv", "in_proj_z"])
    json.dump(a, open(dst / "adapter_config.json", "w"), indent=2)
    return n


if __name__ == "__main__":
    src, outfile = Path(sys.argv[1]), Path(sys.argv[2])
    from huggingface_hub import snapshot_download
    base = Path(snapshot_download("Qwen/Qwen3.5-9B", allow_patterns=["*.json", "*.txt", "*.jinja"]))
    split = src.parent / (src.name + "-split")
    print("split layers:", split_qkvz(src, split, base / "config.json"))
    subprocess.run([sys.executable, f"{LLAMA_CPP}/convert_lora_to_gguf.py", str(split), "--base", str(base),
                    "--outtype", "f16", "--outfile", str(outfile)], check=True)
