  // Show = true
  // Hide = false
  function setLoader(state = false, wrapper = null) {
    const loader = qs('[data-loader]', wrapper);
    if (loader) {
      loader.setAttribute('style', `display: flex; visibility: ${state ? 'visible' : 'hidden'}; opacity: ${state ? 1 : 0}; pointer-events: ${state ? 'auto' : 'none'};`);
      
      if (!state) {
        setTimeout(() => {
          loader.style.display = 'none';
        }, 300);
      }
    }
  }