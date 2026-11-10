from pathlib import Path
import sys

original = Path(sys.argv[1] if len(sys.argv) > 1 else 'footer.reference-layout-tablet.html')
output = Path(sys.argv[2] if len(sys.argv) > 2 else 'footer.success-fix.html')
source = original.read_text()
patches = [
("  native.book.button.addEventListener('click', () => engineConfirm?.click())", """  native.book.button.addEventListener('click', () => {
    if (!engineConfirm || engineConfirm.disabled) return
    const step = engineConfirm.closest('[data-complete-profile-call-step]')
    for (const [name, selector] of [
      ['body', '[data-complete-profile-call-calendar]'],
      ['footer', '[data-complete-profile-call-footer]'],
      ['heading', '[data-jai-trial-greeting]'],
    ]) {
      const panel = step?.querySelector(selector)
      if (panel) step.style.setProperty('--jai-booking-' + name, panel.getBoundingClientRect().height + 'px')
    }
    engineConfirm.click()
  })"""),
("      [data-jai-trial-card] [data-complete-profile-call-success] .call-details_layout { display:grid;", """      [data-jai-trial-card] [data-complete-profile-call-success] { min-block-size:var(--jai-booking-body,30.875rem); }
      [data-jai-trial-card] [data-complete-profile-call-success] .call-details_layout { display:grid;"""),
("      [data-complete-profile-call-step] [data-jai-trial-native-button] .clickable_wrap { z-index:1; }", """      [data-complete-profile-call-step] [data-jai-trial-native-button] .clickable_wrap { z-index:1; }
      [data-jai-trial-native-button="done"] button[data-complete-profile-call-done] { background:transparent; padding:0; }"""),
("        [data-jai-trial-card] [data-complete-profile-call-success] .call-details_layout { gap:1.5rem; }", """        [data-jai-trial-card] [data-complete-profile-call-success] .call-details_layout { gap:1.5rem; }
        [data-jai-trial-card] [data-complete-profile-call-success] { min-block-size:var(--jai-booking-body,0px); }
        [data-jai-trial-card] [data-complete-profile-call-footer]:has(> [data-complete-profile-call-success-actions]:not([hidden])) { min-block-size:var(--jai-booking-footer,0px); justify-content:center; }
        [data-jai-trial-greeting]:has(> [data-complete-profile-call-heading-done]:not([hidden])) { min-block-size:var(--jai-booking-heading,0px); align-content:start; }"""),
]
for old, new in patches:
    assert source.count(old) == 1, old
    source = source.replace(old, new, 1)

output.write_text(source)
output.with_suffix('.js').write_text(source.split('<script>\n', 1)[1].rsplit('</script>', 1)[0])
