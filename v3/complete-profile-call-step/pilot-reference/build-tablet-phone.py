from pathlib import Path
source=Path('footer.reference-layout-tablet.html').read_bytes()
assert len(source.decode()) == 48107
prefix, remainder = source.split(b'    </style>', 1)
markup, module = remainder.split(b'(function(){"use strict";const de=', 1)
module_start = b'(function(){"use strict";const de='
closing = b'</script>\n'

def once(content, before, after):
    assert content.count(before) == 1, before
    return content.replace(before, after, 1)

prefix = once(prefix, b'      @media (min-width:62rem) {', b'      @media (min-width:48rem) {')
prefix = once(prefix,
    b'''      @media (max-width:61.9375rem) {
        [data-complete-profile-call-step] { background:linear-gradient(93.0101deg,#caded9 25.117%,#77a2ab 100.36%); }
        [data-jai-trial-first-step], [data-complete-profile-call-step] { --jai-headroom:5.75rem; --jai-small:2rem; }
        [data-jai-trial-first-step] > .padding-global, [data-complete-profile-call-step] > .padding-global { padding-inline:1rem; }
''',
    b'''      @media (max-width:61.9375rem) {
        [data-jai-trial-first-step] { --jai-headroom:5.75rem; --jai-small:2rem; }
        [data-jai-trial-first-step] > .padding-global { padding-inline:1rem; }
      }
      @media (max-width:47.9375rem) {
        [data-complete-profile-call-step] { min-block-size:0; background:linear-gradient(93.0101deg,#caded9 25.117%,#77a2ab 100.36%); }
        [data-complete-profile-call-step] > .padding-global { padding:117px 16px 0; }
''')
prefix = once(prefix,
    b'''        [data-complete-profile-call-step] [data-jai-trial-layout] { grid-template-columns:minmax(0,1fr); gap:1.5rem; }
        [data-jai-trial-greeting], [data-jai-trial-greeting] > div { gap:.75rem; }
        [data-jai-trial-greeting] h1 { font-size:2.5rem; letter-spacing:-.075rem; }
        [data-jai-trial-greeting] p { font-size:1rem; }
''',
    b'''        [data-complete-profile-call-step] [data-jai-trial-layout] { grid-template-columns:minmax(0,1fr); gap:24px; }
        [data-jai-trial-greeting], [data-jai-trial-greeting] > div { gap:12px; }
        [data-jai-trial-greeting] h1 { font-size:40px; letter-spacing:-1.2px; }
        [data-jai-trial-greeting] p { font-size:16px; }
''')
prefix = once(prefix,
    b'''        [data-jai-trial-quote] blockquote { font-size:1.5rem; letter-spacing:-.045rem; }
        [data-jai-trial-portrait] { position:relative; inset:auto; inline-size:25.125rem; block-size:auto; max-inline-size:none; margin-inline-start:-1.8125rem; margin-block-start:1.5rem; }
        [data-complete-profile-call-step] [data-jai-trial-card] [data-complete-profile-call-footer] { flex-direction:column; align-items:stretch; block-size:auto; padding:1rem; }
''',
    b'''        [data-jai-trial-quote] blockquote { margin-block-end:36px; font-size:24px; letter-spacing:-.72px; }
        [data-jai-trial-quote] figcaption { gap:11px; font-size:18px; }
        [data-jai-trial-portrait-frame] { display:block; block-size:290px; overflow:hidden; margin:24px -16px 0; }
        [data-jai-trial-portrait] { display:block; position:static; inline-size:402px; block-size:485px; max-inline-size:none; margin-inline-start:-13px; }
        [data-complete-profile-call-step] [data-jai-trial-card] [data-complete-profile-call-footer] { flex-direction:column; align-items:stretch; block-size:auto; padding:16px; }
        [data-complete-profile-call-booking-actions] .button_main-element { min-block-size:46px; }
''')
prefix = once(prefix,
    b'        [data-complete-profile-call-step] [data-jai-trial-card] :is([data-complete-profile-call-booking-actions],[data-complete-profile-call-success-actions]) { flex-direction:column-reverse; align-items:stretch; }',
    b'        [data-complete-profile-call-step] [data-jai-trial-card] :is([data-complete-profile-call-booking-actions],[data-complete-profile-call-success-actions]) { flex-direction:column-reverse; align-items:stretch; gap:8px; }')
prefix = once(prefix, b'      [data-jai-trial-portrait] { position:absolute;', b'      [data-jai-trial-portrait-frame] { display:contents; }\n      [data-jai-trial-portrait] { position:absolute;')
portrait_start = markup.index(b'          <img data-jai-trial-portrait ')
portrait_end = markup.index(b'\n', portrait_start)
photo = markup[portrait_start:portrait_end]
markup = once(markup, photo, b'          <div data-jai-trial-portrait-frame>\n  ' + photo + b'\n          </div>')

module = once(module, b'@media (min-width: 62rem) {', b'@media (min-width:48rem) {')
module = once(module, b'''@media (max-width: 61.9375rem) {
  ${t} ${z} { padding: 1rem; }
''', b'''@media (max-width:47.9375rem) {
  ${t} [data-complete-profile-call-calendar]{font-size:16px}
  ${t} ${o("shell")}{padding:0;gap:0}
  ${t} ${o("month")}{padding:16px;border-bottom:1px solid #eee}
  ${t} .ui-datepicker-header{height:45px}
  ${t} .ui-datepicker-calendar :is(th,td){height:57px}
  ${t} ${o("timezone-control")}{width:auto;margin:16px 16px 0}
  ${t} ${o("timezone")}{min-height:50px}
  ${t} ${o("times")}{margin:16px;gap:8px;max-height:216px}
  ${t} [data-paid-calendar-slot]{height:48px}
  ${t} ${z} { padding:16px; }
''')
html=prefix+b'    </style>'+markup+module_start+module
assert html.endswith(closing)
Path('footer.tablet-phone.html').write_bytes(html)
Path('footer.tablet-phone.js').write_bytes(html.split(b'<script>\n',1)[1][:-len(closing)])
