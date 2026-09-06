window.Webflow ||= [];
window.Webflow.push(function () {
  // Memberstack owns src. Webflow's responsive placeholder candidates otherwise
  // outrank that URL on page load, even when the saved member photo is current.
  document.querySelectorAll('img[nav-profile-image][data-ms-member="profile-image"]').forEach(function (image) {
    image.removeAttribute('srcset');
    image.removeAttribute('sizes');
  });

  var menuBtn = document.getElementById('menu-btn');
  if (!menuBtn) return;

  menuBtn.addEventListener('click', function (e) {
    e.preventDefault();
    var body = document.body;
    if (getComputedStyle(body).overflow === 'hidden') {
      body.style.overflow = 'auto';
    } else {
      body.style.overflow = 'hidden';
    }
  });
});
