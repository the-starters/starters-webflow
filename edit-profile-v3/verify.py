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
runtime = root / 'runtime'
# Hidden files are editor and Finder droppings, not bundle content. Every script the
# runtime serves is a manifest path, so anything else visible here is unpinned.
present = {
    str(item.relative_to(runtime)) for item in runtime.rglob('*')
    if item.is_file() and not any(part.startswith('.') for part in item.relative_to(runtime).parts)
}
assert present == known, (
    f'runtime does not match the manifest: unpinned {sorted(present - known)}, '
    f'missing {sorted(known - present)}'
)
print(f'Bundle verified: {len(entries)} scripts')
