/**
 * Fades in the `.nav_bg` layer on scroll for transparent navbar variants.
 *
 * @release v1.59.196
 *
 * The variant attribute follows the Designer component's name — currently
 * `navbar-main` (was `navbar-v2` until the component was renamed, which left
 * this selector matching nothing site-wide).
 */
document.addEventListener('DOMContentLoaded', function () {
    const nav = document.querySelectorAll('[data-wf--navbar-main--variant="transparent"], [data-wf--navbar-main--variant="transparent-light"]');

    nav.forEach(function (nav) {
      const navBg = nav.querySelector('.nav_bg');

      if (!navBg) return;

      function handleScroll() {
        if (window.scrollY > 10) {
          navBg.style.opacity = 1;
        } else {
          navBg.style.opacity = 0;
        }
      }

      window.addEventListener('scroll', handleScroll);

      handleScroll();
    });
});