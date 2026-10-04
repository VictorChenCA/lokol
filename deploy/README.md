# Deploy Lokol Health

| Where | How | Offline? |
|---|---|---|
| Phone browser (PWA) | open https://lokol-studio.vercel.app/demo, Add to Home screen | yes, after the first load |
| Android app | PocketPal AI, Add from Hugging Face: [ANDROID.md](ANDROID.md) | yes |
| Laptop, one line | `ollama run hf.co/VictorChenCA/lokol-health-qwen3-1.7b-gguf` | yes, after the first pull |
| Laptop or clinic PC, model + bridge | `deploy/lokol-laptop.sh` (below) | yes, after the first run |
| WhatsApp / Messenger | installer with `--tunnel`, then [bridge/README.md](../bridge/README.md) | needs signal; the model stays on the laptop |

## Ollama

```bash
ollama run hf.co/VictorChenCA/lokol-health-qwen3-1.7b-gguf     # or ...-0.6b-gguf
```

Ollama reads three files from the Hugging Face repo, kept here in [`ollama/`](ollama/):

- `template`: Qwen3 ChatML with an empty `<think></think>` block, byte-identical to the training prompt (`enable_thinking=False`). The GGUF's own Qwen3 template would let the model think, which it was not trained to do.
- `system`: the training system prompt (`SYSTEM_PROMPT` in `pipeline/style_guide.md`).
- `params`: temperature 0.2, 4096 context, stop on `<|im_end|>`.

`pipeline/publish_hf.py --deploy-only` uploads them with the model card (it checks `system` against the style guide first).

A named local model, for the bridge (which asks for `lokol-health`):

```bash
mkdir -p models/gguf && curl -L -o models/gguf/lokol-health-qwen3-1.7b-Q4_K_M.gguf \
  https://huggingface.co/VictorChenCA/lokol-health-qwen3-1.7b-gguf/resolve/main/lokol-health-qwen3-1.7b-Q4_K_M.gguf
ollama create lokol-health -f deploy/Modelfile.1.7b
LLM_URL=http://127.0.0.1:11434/v1/chat/completions .venv/bin/python -m bridge.server --port 8090
```

The bridge's `/health` probes llama.cpp's `/health`, which Ollama lacks, so it shows the model as not ready; replies still work.

## Laptop installer: `lokol-laptop.sh`

```bash
curl -fsSL https://raw.githubusercontent.com/VictorChenCA/lokol/main/deploy/lokol-laptop.sh | bash -s -- --model 1.7b
# or from a checkout
deploy/lokol-laptop.sh --model 0.6b --voice --tunnel
deploy/lokol-laptop.sh --dry-run
```

What it does, in order:

1. Uses the checkout it sits in, or fetches Lokol into `~/lokol` (`--dir` to change).
2. Checks for `llama-server` (`brew install llama.cpp`), Python 3.10+ and curl; `cloudflared` only with `--tunnel`.
3. Downloads the GGUF from Hugging Face into `models/gguf/` once (resumable).
4. Creates `.venv` and installs `bridge/requirements.txt` (plus `sidecar/requirements.txt` and the speech models with `--voice`). Skipped when already installed.
5. Starts `llama-server` on 8080 (`-c 4096 --jinja`) and waits for it.
6. Starts the bridge on 8090 with `LLM_BACKEND=llama` through `bridge/run_local.sh`, which adds the sidecar on 8091 (`--voice`) and a cloudflared quick tunnel (`--tunnel`), and prints the WhatsApp and Messenger webhook URLs.

Ctrl-C stops everything. `--no-start` installs only. Runs on macOS `/bin/bash` 3.2. Secrets (Twilio, Meta) stay in `.env`; the script never reads or prints them.

Pick `--model 0.6b` on 4 GB machines, `1.7b` (default) otherwise. The River-tuned 9B is hosted; see the Deploy page.

## Tests

```bash
.venv/bin/python -m pytest deploy/test_deploy.py -q
```
