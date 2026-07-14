window.Webflow ||= [];
window.Webflow.push(function () {
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