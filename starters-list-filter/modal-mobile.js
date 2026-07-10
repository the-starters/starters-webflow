// Docs: https://wf-starter-embeds-docs.vercel.app/docs/starters-list-filter/modal-mobile

  window.addEventListener('modal-open', () => {
    const recalc = () => window.dispatchEvent(new Event('resize'));
    requestAnimationFrame(recalc); // once it's in the top layer / has layout
    setTimeout(recalc, 450);       // again after the open tween finishes
  });