#!/usr/bin/env python3
"""Rebuild the original page's mixed-version scripts into an empty directory."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

bundle = Path(__file__).resolve().parent
repo = bundle.parent
if len(sys.argv) != 2:
    raise SystemExit('Usage: python3 edit-profile-v3/materialize_original.py <empty-output-dir>')
output = Path(sys.argv[1]).resolve()
if output.exists() and any(output.iterdir()):
    raise SystemExit(f'Output directory is not empty: {output}')
manifest = json.loads((bundle / 'original-page-pins.json').read_text())
for entry in manifest['scripts']:
    data = subprocess.check_output(['git', 'show', f"{entry['tag']}:{entry['path']}"], cwd=repo)
    if hashlib.sha256(data).hexdigest() != entry['sha256']:
        raise SystemExit(f"Pinned source mismatch: {entry['path']}")
    target = output / entry['path']
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
print(f"Materialized {len(manifest['scripts'])} original-page scripts in {output}")
