"""Regenerate viewer/index.html from board-kit.md after editing the kit's page.

Usage: python3 skills/save-to-kanban/one-board/make-viewer.py
The viewer is the kit's page with empty JSON blocks and data.js + viewer.js loaded before its script.
"""
import os, re, sys

here = os.path.dirname(os.path.abspath(__file__))
md = open(os.path.join(here, 'board-kit.md'), encoding='utf-8').read()
m = re.search(r'```html\n(.*?)\n```', md, re.S)
if not m:
    sys.exit('no html block in board-kit.md')
html = m.group(1)

def empty(html, block_id, value):
    pat = re.compile(r'(<!--[^\n]*-->\n)?(<script id="%s" type="application/json">).*?(</script>)' % block_id, re.S)
    if not pat.search(html):
        sys.exit(f'#{block_id} not found')
    return pat.sub(lambda m: m.group(2) + value + m.group(3), html, count=1)

html = empty(html, 'board-config', '{}')
html = empty(html, 'board-data', '[]')
anchor = '<script id="board-data" type="application/json">[]</script>\n'
html = html.replace(anchor, anchor + '<script src="data.js"></script>\n<script src="viewer.js"></script>\n', 1)
html = html.replace('<title>Team Board</title>', '<title>Kanban</title>', 1)
out = os.path.join(here, '..', 'viewer', 'index.html')
open(out, 'w', encoding='utf-8').write(html + '\n')
print('wrote', os.path.normpath(out))
