#!/usr/bin/env python3
"""Check bundle completeness, byte hashes, loader paths, and JavaScript syntax."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import sys

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
for snippet in (root / 'webflow').glob('*.html'):
    for path in re.findall(r'/edit-profile-v3/runtime/([^"?]+)', snippet.read_text()):
        assert path in known, f'loader references missing script: {path}'
print(f'Bundle verified: {len(entries)} scripts, 2 loader snippets')
