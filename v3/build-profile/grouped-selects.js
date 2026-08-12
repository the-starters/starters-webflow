/**
 * GitHub-owned copy of the Build Profile Webflow controller block.
 * Original live inline body SHA-256: e80bb01f28a43ebcb5b28e8ea733bac273985ddfa3235179cdfc6a9a5168ae84
 * Captured read-only from /build-profile/consult on 2026-08-12.
 */
	$(document).ready(async function () {
		/* INIT */
		await fillRefLists(); // global method

		setTimeout(groupDropdownOptions, 300);

		function groupDropdownOptions() {
			$('[ms-code-select-wrapper="multi"][data-grouped-select="with-category"]').each(function () {
				const $wrapper = $(this);
				const $list = $wrapper.find('[ms-code-select="list"]');
				if ($list.attr('data-grouped') === 'true') return;

				const grouped = {};
				$wrapper
					.closest('.app-form_input_group')
					.find('.fs-cms_item')
					.each(function () {
						const category = $(this).attr('data-category') || 'Other';
						const option = $(this).find('.consult-option, .role-option').text().trim();
						if (!option) return;
						if (!grouped[category]) {
							grouped[category] = [];
						}
						grouped[category].push(option);
					});

				const $options = $list.find('[ms-code-select="tag-name-new"]');
				$options.detach();
				$list.find('.form_option-category').remove();

				Object.keys(grouped).forEach((category) => {
					const $title = $(`<div class="form_option-category">${category}</div>`);
					$list.append($title);
					grouped[category].forEach((value) => {
						const $existingOption = $options.filter(function () {
							return $(this).text().trim() === value;
						});
						$list.append($existingOption);
					});
				});

				$list.attr('data-grouped', 'true');
			});
		}
	});

