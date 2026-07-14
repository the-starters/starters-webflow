document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-navbar-explore="view-all-button"]');
    if (!btn) return;
    var item = btn.closest('.explore_sub_item');
    if (!item) return;
  
    e.preventDefault();
    e.stopPropagation();
  
    var val  = item.getAttribute('wf-algolia-value') || '';
    var leaf = val.split('>').pop().trim();
    var slug = leaf.toLowerCase()
                   .replace(/&/g, 'and')
                   .replace(/[^a-z0-9]+/g, '-')
                   .replace(/(^-|-$)/g, '');
  
    window.location.assign('/subcategories/' + slug);
  }, true);