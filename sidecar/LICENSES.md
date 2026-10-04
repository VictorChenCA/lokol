# Sidecar model licenses

The sidecar downloads these weights into `~/.cache/huggingface/hub` at setup (`sidecar/fetch_models.sh`). None are bundled in the repo. The sidecar code itself is MIT like the rest of Lokol.

| Role | Model | Weights | License | Notes |
|---|---|---|---|---|
| Pijin TTS (`/tts lang=pis`) | Meta MMS TTS, Solomon Islands Pijin (`pis`) | [facebook/mms-tts-pis](https://huggingface.co/facebook/mms-tts-pis), VITS, 36M params, ~145 MB | **CC-BY-NC-4.0** | Non-commercial. Attribution: Pratap et al., *Scaling Speech Technology to 1,000+ Languages* (arXiv:2305.13516). |
| English TTS, primary (`/tts lang=en`) | Kokoro-82M | [hexgrad/Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M), ~330 MB with voices | **Apache-2.0** | Loaded through the `kokoro` pip package (Apache-2.0) and `misaki` G2P. Voice used: `af_heart`. |
| English TTS, fallback | Meta MMS TTS English (`eng`) | [facebook/mms-tts-eng](https://huggingface.co/facebook/mms-tts-eng), ~145 MB | **CC-BY-NC-4.0** | Used only if the `kokoro` package fails to import or run. |
| English ASR (`/asr lang=en`) | OpenAI Whisper tiny (MLX conversion) | [mlx-community/whisper-tiny](https://huggingface.co/mlx-community/whisper-tiny), ~75 MB | **MIT** | Served by `mlx-whisper` (MIT), Apple Silicon only. |
| Pijin / 1,600-language ASR (`/asr lang=pis`) | Meta Omnilingual ASR, CTC-300M | [facebook/omniASR-CTC-300M](https://huggingface.co/facebook/omniASR-CTC-300M) weights; int8 ONNX export [csukuangfj/sherpa-onnx-omnilingual-asr-1600-languages-300M-ctc-int8-2025-11-12](https://huggingface.co/csukuangfj/sherpa-onnx-omnilingual-asr-1600-languages-300M-ctc-int8-2025-11-12), ~365 MB | **Apache-2.0** | Same weights as Meta's release, exported to ONNX by the sherpa-onnx (k2-fsa) project, which is itself Apache-2.0. Served by `sherpa-onnx` on CPU. Pijin (`pis_Latn`) is one of the training languages (~25 h). |
| Pijin ASR, fallback | Meta MMS-1B-all with the `pis` adapter | [facebook/mms-1b-all](https://huggingface.co/facebook/mms-1b-all), ~3.9 GB + 9 MB adapter | **CC-BY-NC-4.0** | Optional (`fetch_models.sh --mms-asr`). Non-commercial. Only used when the Omnilingual ONNX model is missing. |

Runtime libraries: `transformers` (Apache-2.0), `torch` (BSD-3), `sherpa-onnx` (Apache-2.0), `mlx-whisper` (MIT), `kokoro` (Apache-2.0), `misaki` (Apache-2.0), `fastapi` (MIT), `soundfile` (BSD-3, bundles libsndfile LGPL-2.1), `scipy` (BSD-3).

## What this means for a deployment

- The **Apache-2.0 / MIT path** (Omnilingual ASR + Whisper + Kokoro) is clear for commercial and government use.
- Pijin **voice out** currently depends on MMS TTS, which is **non-commercial only**. A ministry or NGO deployment is non-commercial; a paid product would need a different Pijin voice (for example, fine-tuning an Apache-licensed VITS/Kokoro-style model on recorded Pijin, which is listed as future work).
- The sidecar never ships the weights; `fetch_models.sh` pulls them from Hugging Face under each model's own terms.
