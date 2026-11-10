from pathlib import Path
import re
import subprocess

root = Path('/private/tmp/starters-complete-profile-jai-call')
source = (root / 'v3/complete-profile-call-step.js').read_text()

def change(before, after, count=1):
    global source
    assert source.count(before) == count, (before, source.count(before))
    source = source.replace(before, after)

change("!['/complete-profile', '/complete-profile/'].includes(window.location.pathname)", r"!(hostname === staging && /^\/complete-profile-trial\/?$/.test(window.location.pathname))")
change("  const CALENDAR_BUDGET_MS", "  const TRIAL_BOOKING_NOTICE_MS = 24 * 60 * 60 * 1000\n  const CALENDAR_BUDGET_MS")
change("'slotMeetsBookingNotice']", "'slotMeetsBookingNotice', 'getPaidAvailability']")
change("!started && !paid.slotMeetsBookingNotice(slot)", "!started && (!paid.slotMeetsBookingNotice(slot) || slot.start <= Date.now() + TRIAL_BOOKING_NOTICE_MS)")
change("bookingActions.appendChild(confirm)", "nativeTrialConfirm(confirm)", 2)
change("      mounted = await paid.mountPaidCalendar({\n        container: calendar,\n        config: Object.assign({}, config, { grant_id: grantId, duration: 30, price_cents: 0 }),", """      const calendarConfig = Object.assign({}, config, { grant_id: grantId, duration: 30, price_cents: 0 })
      const slots = await paid.getPaidAvailability(calendarConfig)
      if (!active) return
      const earliest = Date.now() + TRIAL_BOOKING_NOTICE_MS
      mounted = await paid.mountPaidCalendar({
        container: calendar,
        config: calendarConfig,
        slots: slots.filter(function (slot) { return slot.start > earliest }),""")
change("      if (select) select.style.cssText = ''", """      if (select) {
        select.style.cssText = ''
        Array.from(select.options).forEach(function (option) {
          option.textContent = option.value.replace(/_/g, ' ').split('/').join(' / ')
        })
      }""")

old_layout = Path('call-step.trial.js').read_text().split('style.textContent = `', 1)[1].split('`', 1)[0]
layout_begin = source.index('style.textContent = `') + len('style.textContent = `')
layout_end = source.index('`', layout_begin)
layout = source[layout_begin:layout_end]
layout = re.sub(r'(?<![\w.])(-?\d+(?:\.\d+)?)px', lambda match: f'{float(match[1])/16:g}rem', layout)
# Preserve the trial calendar's measured height, 494px including the timezone row.
layout = layout.replace("max-height: 25rem; margin: 0 1.5rem 1.5rem;", "max-height: 25.25rem; margin: 0 1.5rem;")
source = source[:layout_begin] + layout + source[layout_end:]
Path('call-step.round1.trial.js').write_text(source)
esbuild = '/Users/standarduser/Documents/starters/starters-git/wf-xano-docs/node_modules/@esbuild/darwin-arm64/bin/esbuild'
packed = subprocess.check_output([esbuild, '--minify', '--legal-comments=none', '--loader=js'], input=source, text=True)
prefix = Path('footer-prefix.round1.html').read_text()
suffix = Path('footer-suffix.html').read_text()
footer = prefix + packed + suffix
assert footer.count('<script>') == footer.count('</script>') == 1
assert len(footer) < 50000, len(footer)
Path('footer.round1.html').write_text(footer)
Path('footer.round1.js').write_text(footer.split('<script>', 1)[1].split('</script>', 1)[0].strip() + '\n')
print(f'Trial footer: {len(footer):,} characters')
