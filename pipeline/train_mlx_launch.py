"""mlx_lm.lora launcher with a speed patch for Qwen3.5 (hybrid linear-attention) LoRA on Apple Silicon.

Why: in training mode mlx_lm's GatedDeltaNet runs a per-token Python recurrence (`gated_delta_ops`) for all 18 linear-attention
layers so the Metal kernel can be differentiated. At seq 512-2048 that is a ~10k-node graph plus backward per step; macOS 26
aborts the command buffer ("Impacting Interactivity") or crawls. Gradients only flow through layers that sit above the lowest
LoRA'd layer, so every linear-attention block below it (and any frozen block) can keep the fast fused kernel. With
--num-layers 8 that leaves 6 slow blocks instead of 18; with 4, 3.

Usage: identical to `python -m mlx_lm lora ...`:
    .venv/bin/python pipeline/train_mlx_launch.py --model mlx-community/Qwen3.5-0.8B-MLX-bf16 --train --data data/mlx/0.8B ...
"""
import sys

import mlx_lm.lora as L
from mlx.utils import tree_flatten
from mlx_lm.models.qwen3_5 import GatedDeltaNet

_orig_call = GatedDeltaNet.__call__

def _fast_call(self, *args, **kwargs):
    if getattr(self, "_lokol_fast", False) and self._training:
        self._training = False  # forward only: use the fused Metal kernel, no gradient needed through this block
        try:
            return _orig_call(self, *args, **kwargs)
        finally:
            self._training = True
    return _orig_call(self, *args, **kwargs)

GatedDeltaNet.__call__ = _fast_call

_orig_l2l = L.linear_to_lora_layers

def _mark(model):
    seen_trainable = False
    fast = slow = 0
    for layer in model.layers:
        layer_trainable = len(tree_flatten(layer.trainable_parameters())) > 0
        for _, m in layer.named_modules():
            if isinstance(m, GatedDeltaNet):
                own = len(tree_flatten(m.trainable_parameters())) > 0
                m._lokol_fast = not (seen_trainable or own)
                fast += m._lokol_fast; slow += not m._lokol_fast
        seen_trainable = seen_trainable or layer_trainable
    print(f"[lokol] linear-attention blocks: {fast} on the fused kernel, {slow} on the differentiable loop", flush=True)

def _patched_l2l(model, *a, **k):
    out = _orig_l2l(model, *a, **k)
    _mark(model)
    return out

L.linear_to_lora_layers = _patched_l2l

if __name__ == "__main__":
    sys.argv[0] = "mlx_lm.lora"
    L.main()
