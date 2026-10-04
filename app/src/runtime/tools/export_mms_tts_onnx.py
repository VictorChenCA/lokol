"""Export facebook/mms-tts-pis (VITS, Solomon Islands Pijin) to ONNX in the layout transformers.js expects,
quantize a dynamic-int8 copy, smoke-test both with onnxruntime, and (optionally) upload to the Hub.

  .venv/bin/python app/src/runtime/tools/export_mms_tts_onnx.py [out_dir] [--upload VictorChenCA/lokol-mms-tts-pis-onnx]

Needs: torch, transformers, onnx, onnxruntime, onnxscript, huggingface_hub (uv pip install --python .venv/bin/python onnx onnxruntime onnxscript).
Output: out_dir/{config.json, tokenizer.json, tokenizer_config.json, vocab.json, onnx/model.onnx (fp32, 114 MB), onnx/model_quantized.onnx (int8, 38 MB), README.md}
License of the source model is CC-BY-NC-4.0; the export inherits it.
"""
import json, os, re, sys, time

import torch
from transformers import AutoConfig, VitsModel, VitsTokenizer

SRC = "facebook/mms-tts-pis"
args = [a for a in sys.argv[1:] if not a.startswith("--")]
OUT = args[0] if args else os.path.join(os.path.dirname(__file__), "..", "dev", "models", "mms-tts-pis-onnx")
OUT = os.path.abspath(OUT)
UPLOAD = None
if "--upload" in sys.argv:
    UPLOAD = sys.argv[sys.argv.index("--upload") + 1]
os.makedirs(os.path.join(OUT, "onnx"), exist_ok=True)

t0 = time.time()
tok = VitsTokenizer.from_pretrained(SRC)
model = VitsModel.from_pretrained(SRC).eval()
cfg = AutoConfig.from_pretrained(SRC)


class Wrapper(torch.nn.Module):
    def __init__(self, m):
        super().__init__()
        self.m = m

    def forward(self, input_ids, attention_mask):
        return self.m(input_ids=input_ids, attention_mask=attention_mask).waveform


w = Wrapper(model)
enc = tok("mi no sua, askem nes", return_tensors="pt")
onnx_path = os.path.join(OUT, "onnx", "model.onnx")
torch.onnx.export(
    w, (enc["input_ids"], enc["attention_mask"]), onnx_path,
    input_names=["input_ids", "attention_mask"], output_names=["waveform"],
    dynamic_axes={"input_ids": {0: "batch_size", 1: "sequence_length"}, "attention_mask": {0: "batch_size", 1: "sequence_length"}, "waveform": {0: "batch_size", 1: "waveform_length"}},
    opset_version=17, dynamo=False, do_constant_folding=True,
)
print("exported", round(time.time() - t0, 1), "s", round(os.path.getsize(onnx_path) / 1e6, 1), "MB")
cfg.save_pretrained(OUT)
tok.save_pretrained(OUT)

# tokenizer.json in the shape transformers.js VitsTokenizer reads (mirrors Xenova/mms-tts-eng)
vocab = json.load(open(os.path.join(OUT, "vocab.json")))
pad = tok.pad_token
unk_id = max(vocab.values()) + 1
charset = "".join(re.escape(c) if c in "-]^\\" else c for c in vocab if c != pad)
json.dump({
    "version": "1.0", "truncation": None, "padding": None,
    "added_tokens": [{"id": unk_id, "content": "<unk>", "single_word": False, "lstrip": False, "rstrip": False, "normalized": False, "special": True}],
    "normalizer": {"type": "Sequence", "normalizers": [
        {"type": "Lowercase"},
        {"type": "Replace", "pattern": {"Regex": "[^" + charset + "]"}, "content": ""},
        {"type": "Strip", "strip_left": True, "strip_right": True},
        {"type": "Replace", "pattern": {"Regex": "(?=.)|(?<!^)$"}, "content": pad},
    ]},
    "pre_tokenizer": {"type": "Split", "pattern": {"Regex": ""}, "behavior": "Isolated", "invert": False},
    "post_processor": None, "decoder": None,
    "model": {"vocab": {**vocab, "<unk>": unk_id}},
}, open(os.path.join(OUT, "tokenizer.json"), "w"), indent=1, ensure_ascii=False)

from onnxruntime.quantization import QuantType, quantize_dynamic
qpath = os.path.join(OUT, "onnx", "model_quantized.onnx")
quantize_dynamic(onnx_path, qpath, weight_type=QuantType.QUInt8)

import numpy as np, onnxruntime as ort
for p in (onnx_path, qpath):
    sess = ort.InferenceSession(p, providers=["CPUExecutionProvider"])
    e = tok("Mi no sua, askem nes", return_tensors="np")
    y = sess.run(None, {"input_ids": e["input_ids"].astype(np.int64), "attention_mask": e["attention_mask"].astype(np.int64)})[0]
    print(os.path.basename(p), y.shape, f"{y.shape[1] / cfg.sampling_rate:.2f}s", "rms", round(float(np.sqrt((y ** 2).mean())), 4), round(os.path.getsize(p) / 1e6, 1), "MB")

open(os.path.join(OUT, "README.md"), "w").write(f"""---
license: cc-by-nc-4.0
base_model: {SRC}
language: [pis]
pipeline_tag: text-to-speech
library_name: transformers.js
tags: [vits, mms, solomon-islands-pijin, lokol]
---
# lokol-mms-tts-pis-onnx
ONNX export of [{SRC}](https://huggingface.co/{SRC}) (Meta MMS VITS, Solomon Islands Pijin) in the Transformers.js layout
(`onnx/model.onnx` fp32, `onnx/model_quantized.onnx` dynamic int8, `tokenizer.json`, `config.json`). Inputs `input_ids`, `attention_mask`; output `waveform` (16 kHz).
Made for the Lokol Health pack (in-browser Pijin voice out). License follows the source model: CC-BY-NC-4.0. Demo use only, not clinical.
""")
print("DONE", OUT, round(time.time() - t0, 1), "s")

if UPLOAD:
    from huggingface_hub import HfApi, create_repo
    create_repo(UPLOAD, repo_type="model", exist_ok=True)
    HfApi().upload_folder(folder_path=OUT, repo_id=UPLOAD, repo_type="model", commit_message=f"ONNX export of {SRC} for transformers.js")
    print("UPLOADED", UPLOAD)
