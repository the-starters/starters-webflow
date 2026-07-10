// Docs: https://wf-starter-embeds-docs.vercel.app/docs/global-embeds/list-sort-dropdown

  document.addEventListener('DOMContentLoaded', () => {
    const firstOption = document.querySelectorAll('.list-sort_dropdown-links-wrapper [fs-list-element="clear"]');

    firstOption.forEach((item) => {
      setTimeout(() => {
        item.click();
      }, 1000);
    });
  });