from pathlib import Path

source = Path('footer-prefix.visual.html').read_text()
reference = Path('/Users/standarduser/Documents/starters/starters-git/.scratch/complete-profile-jai-call/existing-call-requested-card.html').read_text()

def replace(before, after):
    global source
    assert source.count(before) == 1, before
    source = source.replace(before, after, 1)

# Keep the published success card's body and CSS classes. The popup-specific
# wrapper and controls stay with the popup.
receipt = reference.split('class="call-sched_details-layout height-auto">', 1)[1].split('<div paid-call-text="">', 1)[0] + '</div>'
receipt = receipt.replace('class="heading-style-h1">Call', 'class="heading-style-h1" role="heading" aria-level="2">Call')
receipt = receipt.replace('class="icon-36"><svg', 'class="icon-36" aria-hidden="true"><svg')
receipt = receipt.replace('We&#x27;ll share your call request with [Starter] and reach out when it&#x27;s been confirmed, typically within 48 hours', "We'll share your call request with Jai and reach out when it's been confirmed, typically within 24 hours")
receipt = receipt.replace('>Paid</p>', '>Free</p>').replace('>March 12, 2026</p>', '></p>').replace('>3:00PM EST</p>', '></p>').replace('>$500</p>', '>$0</p>')
receipt = receipt.replace('<div display-flex="" booking-element-wrap="" class="call-details_table-item">', '<div display-flex="" booking-element-wrap="" class="call-details_table-item" hidden>')
receipt = receipt.replace('>[Starter]</span>', '>Jai</span>').replace(">Let&#x27;s get ready to discuss your marketing strategy and goals!</p>", '></p>')
receipt = receipt.replace('><div', '>\n                  <div').replace('><p', '>\n                    <p')
old_body_start = '                <div class="complete-profile_button-wrapper" data-complete-profile-call-footer></div>'
old_body_end = '                  <div data-jai-trial-success-action></div>\n                </div>'
before = source[source.index(old_body_start):source.index(old_body_end) + len(old_body_end)]
replace(before, '''                <div data-complete-profile-call-success hidden>
                  ''' + receipt + '''
                </div>
                <div class="complete-profile_button-wrapper" data-complete-profile-call-footer>
                  <div data-complete-profile-call-booking-actions></div>
                  <div data-complete-profile-call-success-actions hidden></div>
                </div>''')

replace('''  newStep.querySelector('[data-complete-profile-call-footer]').append(native.skip.holder, native.book.holder)
  newStep.querySelector('[data-jai-trial-success-action]').append(native.done.holder)''', '''  newStep.querySelector('[data-complete-profile-call-booking-actions]').append(native.skip.holder, native.book.holder)
  newStep.querySelector('[data-complete-profile-call-success-actions]').append(native.done.holder)''')

replace('''        <div class="container-large">
          <div class="complete-profile_layout" data-jai-trial-layout>''', '''        <div class="container-large" data-jai-trial-content>
          <div class="complete-profile_layout" data-jai-trial-layout>''')

replace('''      [data-complete-profile-call-step] [data-jai-trial-layout]''', '''      [data-complete-profile-call-step] [data-jai-trial-content] { position:relative; }
      [data-complete-profile-call-step] [data-jai-trial-layout]''') if source.count('      [data-complete-profile-call-step] [data-jai-trial-layout]') == 1 else None
if '[data-jai-trial-content] { position:relative; }' not in source:
    replace('''      [data-jai-trial-greeting] { grid-column''', '''      [data-complete-profile-call-step] [data-jai-trial-content] { position:relative; }
      [data-jai-trial-greeting] { grid-column''')
replace('''min-inline-size:0; inline-size:100%; max-inline-size:none; border-radius:.25rem; background:#fff; overflow:hidden;''', '''position:relative; min-inline-size:0; inline-size:100%; max-inline-size:none; border-radius:.25rem; background:#fff; overflow:hidden;''')
replace('''inset-block-start:38.8125rem; inset-inline-start:-5.9375rem;''', '''inset-block-start:26.75rem; inset-inline-start:-12.1875rem;''')

css_start = '      [data-jai-trial-card] [data-complete-profile-call-unavailable], [data-jai-trial-card] [data-complete-profile-call-success] { padding:2.5rem; }'
css_end = '      [data-complete-profile-call-step] [data-paid-calendar-element="timezone-control"] { position:relative; }'
before = source[source.index(css_start):source.index(css_end)]
replace(before, '''      [data-jai-trial-card] [data-complete-profile-call-unavailable] { padding:2.5rem; }
      [data-jai-trial-card] [data-complete-profile-call-success] .call-details_layout { display:grid; gap:2.5rem; padding:2.5rem; }
      [data-jai-trial-card] [data-complete-profile-call-success] .call-details_headline-wrapper { display:grid; gap:.75rem; }
      [data-jai-trial-card] [data-complete-profile-call-success] .call-details_heading-wrapper { display:flex; align-items:center; gap:.75rem; color:#1f4664; }
      [data-jai-trial-card] [data-complete-profile-call-success] .icon-36 { display:flex; inline-size:2.25rem; block-size:2.25rem; flex:none; }
      [data-jai-trial-card] [data-complete-profile-call-success] .heading-style-h1 { margin:0; font-family:Baskervville,Georgia,serif; font-size:2.25rem; font-weight:500; line-height:1.2; letter-spacing:-.0675rem; }
      [data-jai-trial-card] [data-complete-profile-call-success] [booking-success-text] { max-inline-size:31.25rem; margin:0; color:#434b43; font-size:1rem; line-height:1.7; }
      [data-jai-trial-card] [data-complete-profile-call-success] .call-details_table-details { display:grid; gap:.125rem; overflow:hidden; border:.125rem solid #eee; border-radius:.25rem; background:#eee; }
      [data-jai-trial-card] [data-complete-profile-call-success] .call-details_table-item { background:#fff; }
      [data-jai-trial-card] [data-complete-profile-call-success] .call-details_table-item.is-first { display:grid; grid-template-columns:minmax(0,18.0625rem) minmax(0,1fr) 6.25rem; align-items:center; min-block-size:7.5rem; padding:.5rem; box-sizing:border-box; }
      [data-jai-trial-card] [data-complete-profile-call-success] .call-details_table-title { min-inline-size:0; padding-inline:1rem; }
      [data-jai-trial-card] [data-complete-profile-call-success] [booking-element="paid-meeting"] { margin:0; color:#1e211e; font-size:1rem; font-weight:500; }
      [data-jai-trial-card] [data-complete-profile-call-success] .call-details_table-item.is-date-time-mobile { display:none; }
      [data-jai-trial-card] [data-complete-profile-call-success] .two-type-label_component { display:inline-flex; gap:.0625rem; flex-wrap:wrap; max-inline-size:100%; }
      [data-jai-trial-card] [data-complete-profile-call-success] .two-type-label_item { display:flex; align-items:center; min-block-size:2rem; padding-inline:.5rem; border-radius:0 .25rem .25rem 0; background:#eee; }
      [data-jai-trial-card] [data-complete-profile-call-success] .two-type-label_item.is-first { border-radius:.25rem 0 0 .25rem; }
      [data-jai-trial-card] [data-complete-profile-call-success] .two-type-label_text { margin:0; font-size:.8125rem; font-weight:500; white-space:nowrap; }
      [data-jai-trial-card] [data-complete-profile-call-success] .two-type-label_text.is-bold { font-weight:700; }
      [data-jai-trial-card] [data-complete-profile-call-success] .table-price_layout.is-consult { display:grid; place-content:center; gap:.5rem; inline-size:6.25rem; block-size:6.25rem; border-radius:.25rem; background:#1f4664; color:#fff; text-align:center; }
      [data-jai-trial-card] [data-complete-profile-call-success] .table-price_layout p { margin:0; font-size:.75rem; line-height:1; }
      [data-jai-trial-card] [data-complete-profile-call-success] .table-price_layout [booking-element="price"] { font-size:1.125rem; font-weight:600; }
      [data-complete-profile-call-step] [data-jai-trial-card] [data-complete-profile-call-footer] { display:flex; align-items:center; justify-content:flex-end; min-block-size:6.125rem; padding:1.625rem 2rem; box-sizing:border-box; border-block-start:.0625rem solid #eee; background:#fff; }
      [data-complete-profile-call-step] [data-jai-trial-card] :is([data-complete-profile-call-booking-actions],[data-complete-profile-call-success-actions]) { display:flex; align-items:center; justify-content:flex-end; gap:.5rem; }
      [data-complete-profile-call-step] [data-paid-calendar-element="confirm"][hidden],
      [data-complete-profile-call-step="unavailable"] [data-jai-trial-native-button="book"] { display:none; }
      [data-complete-profile-call-step] [data-jai-trial-native-button] .clickable_wrap { z-index:1; }
      [data-complete-profile-call-step] [data-jai-trial-native-button] .button_main-wrap:has(.clickable_btn:focus-visible) { outline:.125rem solid #1f4664; outline-offset:.1875rem; box-shadow:0 0 0 .1875rem #fff; }
      [data-complete-profile-call-step] [data-jai-trial-card] [data-paid-calendar-element="status"] { position:absolute; inset:0 0 auto; z-index:2; margin:0; padding:1rem 2rem; background:#1e211e; color:#fff; font-size:1rem; line-height:1.125; }
      [data-complete-profile-call-step] [data-jai-trial-card] [data-paid-calendar-element="status"][data-paid-calendar-status="error"] { background:#c63d33; color:#fff; }
      [data-complete-profile-call-step] [data-jai-trial-card] [data-paid-calendar-element="status"]:empty { display:none; }
      [data-complete-profile-call-step] [data-jai-trial-card] [data-paid-calendar-element="loading"] { position:relative; display:grid; place-items:center; min-block-size:30.875rem; }
      [data-complete-profile-call-step] [data-jai-trial-card] [data-paid-calendar-element="loading"] .experts-list_loader.is-complete-profile { position:static; display:block; margin:0; transform:none; }
      [data-complete-profile-call-step] [data-jai-trial-card] [data-paid-calendar-element="loading-text"] { position:absolute; inline-size:1px; block-size:1px; padding:0; margin:-1px; overflow:hidden; clip-path:inset(50%); white-space:nowrap; }
      [data-complete-profile-call-step] [data-complete-profile-call-calendar] [data-paid-calendar-element="month"] .ui-datepicker { inline-size:100%; max-inline-size:none; box-sizing:border-box; border:0; border-radius:.5rem; background:#eee; box-shadow:0 0 0 2px #eee, 0 4px 8px rgba(0,0,0,.1); }
      [data-complete-profile-call-step] [data-complete-profile-call-calendar] [data-paid-calendar-element="month"] .ui-datepicker-calendar { overflow:hidden; border-radius:.5rem; background:#fff; }
      [data-complete-profile-call-step] [data-complete-profile-call-calendar] [data-complete-profile-call-month-nav]:focus-visible { outline:.125rem solid #1f4664; outline-offset:.125rem; }
''')
replace('''[data-complete-profile-call-step] [data-paid-calendar-element="shell"] { min-block-size:30.8125rem; }''', '''[data-complete-profile-call-step] [data-jai-trial-card] [data-paid-calendar-element="shell"] { min-block-size:30.875rem; }''')
replace('''      [data-complete-profile-call-step] [data-paid-calendar-element="month"] .ui-datepicker-header :is(.ui-datepicker-prev,.ui-datepicker-next)::after { transform:none; inline-size:1.25rem; block-size:1.25rem; border:0; background:center / contain no-repeat; }
      [data-complete-profile-call-step] [data-paid-calendar-element="month"] .ui-datepicker-prev::after { background-image:url("https://cdn.prod.website-files.com/69c573f20f82bd0f3384032c/6af32e2586ca023172754ce8_complete-profile-previous.svg") !important; }
      [data-complete-profile-call-step] [data-paid-calendar-element="month"] .ui-datepicker-next::after { background-image:url("https://cdn.prod.website-files.com/69c573f20f82bd0f3384032c/6af32e261502cc49dc8c1a3d_complete-profile-next.svg") !important; }''', '''      [data-complete-profile-call-step] [data-complete-profile-call-calendar] [data-paid-calendar-element="month"] .ui-datepicker-header :is(.ui-datepicker-prev,.ui-datepicker-next)::after { transform:none; inline-size:1.25rem; block-size:1.25rem; border:0; background-position:center; background-size:contain; background-repeat:no-repeat; }
      [data-complete-profile-call-step] [data-complete-profile-call-calendar] [data-paid-calendar-element="month"] .ui-datepicker-prev::after { background-image:url("https://cdn.prod.website-files.com/69c573f20f82bd0f3384032c/6af32e2586ca023172754ce8_complete-profile-previous.svg"); }
      [data-complete-profile-call-step] [data-complete-profile-call-calendar] [data-paid-calendar-element="month"] .ui-datepicker-next::after { background-image:url("https://cdn.prod.website-files.com/69c573f20f82bd0f3384032c/6af32e261502cc49dc8c1a3d_complete-profile-next.svg"); }''')
replace('''        [data-complete-profile-call-step] [data-jai-trial-card] [data-complete-profile-call-footer] { flex-direction:column-reverse; align-items:stretch; min-block-size:0; padding:1rem; }''', '''        [data-complete-profile-call-step] [data-jai-trial-card] [data-complete-profile-call-footer] { flex-direction:column; align-items:stretch; min-block-size:0; padding:1rem; }
        [data-complete-profile-call-step] [data-jai-trial-card] :is([data-complete-profile-call-booking-actions],[data-complete-profile-call-success-actions]) { flex-direction:column-reverse; align-items:stretch; }
        [data-complete-profile-call-step] [data-jai-trial-card] [data-paid-calendar-element="loading"] { min-block-size:22rem; }''')
replace('''        [data-jai-trial-card] [data-complete-profile-call-unavailable], [data-jai-trial-card] [data-complete-profile-call-success] { padding:1.5rem 1rem; }''', '''        [data-jai-trial-card] [data-complete-profile-call-unavailable],
        [data-jai-trial-card] [data-complete-profile-call-success] .call-details_layout { padding:1.5rem 1rem; }
        [data-jai-trial-card] [data-complete-profile-call-success] .call-details_layout { gap:1.5rem; }
        [data-jai-trial-card] [data-complete-profile-call-success] .call-details_table-item.is-first { grid-template-columns:minmax(0,1fr) 6.25rem; }
        [data-jai-trial-card] [data-complete-profile-call-success] .call-details_table-label.is-date-time { display:none; }
        [data-jai-trial-card] [data-complete-profile-call-success] .call-details_table-item.is-date-time-mobile { display:block; padding:.75rem; }''')
Path('footer-prefix.round1.html').write_text(source)
