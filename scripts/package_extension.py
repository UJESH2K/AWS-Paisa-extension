"""Builds dist/paisa-extension-<version>.zip from extension/ (manifest.json at the zip root).
Uses zipfile so entry names use forward slashes, which the Edge/Chrome stores require."""
import json
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "extension"
version = json.loads((SRC / "manifest.json").read_text(encoding="utf-8"))["version"]
out = ROOT / "dist" / f"paisa-extension-{version}.zip"
out.parent.mkdir(exist_ok=True)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for p in sorted(SRC.rglob("*")):
        if p.is_file() and not p.name.startswith("."):
            z.write(p, p.relative_to(SRC).as_posix())
with zipfile.ZipFile(out) as z:
    names = z.namelist()
    assert "manifest.json" in names and not any("\\" in n for n in names)
    print(out)
    for n in names:
        print(" ", n)
