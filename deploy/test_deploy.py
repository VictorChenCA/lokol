"""Deploy files stay in sync with training: system prompt, ChatML template with thinking off, params, installer.

    .venv/bin/python -m pytest deploy/test_deploy.py -q
"""
import json, re, shutil, subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
D = ROOT / "deploy"


def style_guide_system():
    sg = (ROOT / "pipeline" / "style_guide.md").read_text()
    return re.search(r"## SYSTEM_PROMPT\s*\n\s*```text\n(.*?)\n```", sg, re.S).group(1)


def test_system_is_the_training_prompt():
    assert (D / "ollama" / "system").read_text() == style_guide_system()


def test_params():
    p = json.loads((D / "ollama" / "params").read_text())
    assert p["temperature"] == 0.2 and p["num_ctx"] == 4096 and "<|im_end|>" in p["stop"]


def test_template_prefills_empty_think_block():
    t = (D / "ollama" / "template").read_text()
    assert "<|im_start|>assistant\n<think>\n\n</think>\n\n{{ end }}" in t
    assert "{{ .System }}" in t and "range $i, $_ := .Messages" in t


def test_template_renders_like_training_when_go_is_available():
    go = shutil.which("go") or ("/usr/local/go/bin/go" if Path("/usr/local/go/bin/go").exists() else None)
    if not go:
        return
    import tempfile
    src = 'package main\nimport ("os";"text/template")\ntype M struct{ Role, Content string }\nfunc main(){b,_:=os.ReadFile(os.Args[1]);t:=template.Must(template.New("t").Parse(string(b)));t.Execute(os.Stdout,map[string]any{"System":"S","Messages":[]M{{"system","S"},{"user","U"}}})}\n'
    with tempfile.TemporaryDirectory() as tmp:
        (Path(tmp) / "main.go").write_text(src)
        out = subprocess.run([go, "run", "main.go", str(D / "ollama" / "template")], cwd=tmp, capture_output=True, text=True, timeout=120)
    assert out.stdout == "<|im_start|>system\nS<|im_end|>\n<|im_start|>user\nU<|im_end|>\n<|im_start|>assistant\n<think>\n\n</think>\n\n", out.stderr


def test_modelfiles_embed_the_same_files():
    t = (D / "ollama" / "template").read_text()
    for size in ("0.6b", "1.7b"):
        mf = (D / f"Modelfile.{size}").read_text()
        assert f"FROM ../models/gguf/lokol-health-qwen3-{size}-Q4_K_M.gguf" in mf
        assert f'TEMPLATE """{t}"""' in mf
        assert f'SYSTEM """{style_guide_system()}"""' in mf
        assert "PARAMETER stop <|im_end|>" in mf and "PARAMETER temperature 0.2" in mf


def test_installer_bash32_dry_run():
    sh = str(D / "lokol-laptop.sh")
    assert subprocess.run(["/bin/bash", "-n", sh]).returncode == 0
    out = subprocess.run(["/bin/bash", sh, "--dry-run", "--model", "0.6b", "--tunnel"], capture_output=True, text=True, timeout=60)
    assert out.returncode == 0, out.stderr
    assert "DRY RUN" in out.stdout and "--port 8080 -c 4096 --jinja" in out.stdout
    assert "LLM_BACKEND=llama" in out.stdout and "NO_TUNNEL=0" in out.stdout
    assert "lokol-health-qwen3-0.6b-Q4_K_M.gguf" in out.stdout
    bad = subprocess.run(["/bin/bash", sh, "--model", "9b", "--dry-run"], capture_output=True, text=True)
    assert bad.returncode == 2
