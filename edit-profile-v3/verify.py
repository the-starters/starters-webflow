#!/usr/bin/env python3
"""Check bundle completeness, byte hashes, and JavaScript syntax."""
from pathlib import Path
import hashlib
import json
import subprocess

root = Path(__file__).resolve().parent
manifest = json.loads((root / 'manifest.json').read_text())
entries = manifest['runtime']
known = {entry['path'] for entry in entries}
assert len(known) == len(entries), 'duplicate runtime path'
for entry in entries:
    path = root / 'runtime' / entry['path']
    data = path.read_bytes()
    assert len(data) == entry['bytes'], f'byte length mismatch: {path}'
    assert hashlib.sha256(data).hexdigest() == entry['sha256'], f'hash mismatch: {path}'
    if path.suffix == '.js':
        subprocess.run(['node', '--check', str(path)], check=True, stdout=subprocess.DEVNULL)
print(f'Bundle verified: {len(entries)} scripts')
