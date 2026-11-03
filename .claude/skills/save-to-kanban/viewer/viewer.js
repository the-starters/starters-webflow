// Feeds the board page: turns data.js (window.KANBAN, rebuilt by kanban.sh after every write) into
// the page's #board-config and #board-data blocks. index.html is generated from one-board/board-kit.md.
(() => {
  const data = window.KANBAN || { boards: [] };
  const repo = data.repo || '';
  const name = data.name || (repo ? repo.split('/').pop() : '') || 'Kanban';
  const store = 'kanban-' + (repo || name).toLowerCase().replace(/[^\w-]+/g, '-');
  // Card times are UTC ISO strings; the page shows times as written, so give it local ones.
  const local = t => { const d = new Date(t || ''); if (isNaN(d)) return ''; const z = new Date(d - d.getTimezoneOffset() * 6e4); return z.toISOString().slice(0, 16); };
  const gh = (kind, n) => (repo ? `https://github.com/${repo}/${kind}/${String(n).replace(/^#/, '')}` : '');

  const config = {
    title: `${name} kanban`, brand: name, storageKey: store,
    issueUrl: repo ? `https://github.com/${repo}/issues/{id}` : '',
    types: { fix: { label: 'Fix' }, ticket: { label: 'Ticket', accent: true } },
    boards: {},
  };
  const cards = [];
  for (const b of data.boards || []) {
    config.boards[b.key] = { label: String(b.title || b.key).replace(/\s+Board$/i, '') };
    if (typeof b.hue === 'number') config.boards[b.key].hue = b.hue;
    for (const c of b.cards || []) {
      const qaFail = c.qa && c.qa.last === 'fail' ? `QA failed: ${c.qa.note || ''}`.trim() : '';
      cards.push({
        id: c.id, title: c.title, status: c.status, board: b.key, type: c.kind, area: c.area,
        owner: c.ownedBy || b.owner, agent: c.owner, blocker: c.blocker,
        progress: [c.priority, c.progress || qaFail].filter(Boolean).join(' · '),
        branch: c.branch, pr: /^https?:/.test(c.pr || '') ? c.pr : c.pr ? gh('pull', c.pr) : '',
        issue: c.issue || c.spec || '',
        detail: [c.detail, c.where && `Where: ${c.where}`, c.notesText].filter(Boolean).join('\n\n'),
        createdAt: local(c.createdAt), updatedAt: local(c.updatedAt),
      });
    }
  }
  // kanban.sh view <board> opens index.html#<board>: start on that board.
  const hashBoard = decodeURIComponent(location.hash.slice(1));
  if (hashBoard && Object.hasOwn(config.boards, hashBoard)) try { localStorage.setItem(`${store}-board`, hashBoard); } catch (e) {}

  const put = (id, v) => { document.getElementById(id).textContent = JSON.stringify(v); };
  put('board-config', config);
  put('board-data', cards);
})();
