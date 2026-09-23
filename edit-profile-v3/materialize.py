#!/usr/bin/env python3
"""Rebuild the local runtime from immutable Git tags and this folder's patch."""
from pathlib import Path
import hashlib
import json
import subprocess
import sys

bundle = Path(__file__).resolve().parent
repo = bundle.parent
output = Path(sys.argv[1]).resolve() if len(sys.argv) > 1 else bundle / 'runtime'
manifest = json.loads((bundle / 'manifest.json').read_text())
for entry in manifest['runtime']:
    data = subprocess.check_output(['git', 'show', f"{entry['baseline_tag']}:{entry['path']}"], cwd=repo)
    target = output / entry['path']
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(data)
subprocess.run(['patch', '-p1', '-i', str(bundle / 'patches/work-experience-month-picker.patch')], cwd=output, check=True)
for entry in manifest['runtime']:
    target = output / entry['path']
    data = target.read_bytes()
    if len(data) != entry['bytes'] or hashlib.sha256(data).hexdigest() != entry['sha256']:
        raise SystemExit(f'Bundle mismatch: {entry["path"]}')
print(f'Materialized {len(manifest["runtime"])} scripts in {output}')
