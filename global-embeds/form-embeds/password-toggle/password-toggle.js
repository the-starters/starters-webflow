// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/form-embeds/password-toggle

document.addEventListener('DOMContentLoaded', function () {
    const passwordInputs = document.querySelectorAll('[data-password-input]');

    passwordInputs.forEach(function (input) {
      const toggle = input.querySelector('[data-password-toggle]');
      const passwordField = input.querySelector('input');
      if (!toggle) return;

      toggle.addEventListener('click', function () {
        if (passwordField.type === 'password') {
          passwordField.type = 'text';
          toggle.classList.add('show-password');
        } else {
          passwordField.type = 'password';
          toggle.classList.remove('show-password');
        }
      });
    });
  });