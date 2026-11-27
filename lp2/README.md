# /lp2 scripts

Behaviour for the paid landing page at `/lp2` ("Landing Page 2 (Direct)"). The page is built in Webflow. Its styles,
the code that must run before first paint, and the code whose failure would mislead a visitor (prices, controls)
stay in Code Embeds on that page. The files here hold the rest of its JavaScript, loaded with `defer` from those
embeds.

Everything is page-scoped: nothing here is installed in the site head or footer, and every selector is scoped to
`[data-lp-page]` or an `lp-*` section of this page.

## Files

| File | What it does | Loaded from |
| --- | --- | --- |
| `stuck.js` | Reorders the pain cards so the ones matching the ad come first; re-runs the hero swap if the inline one did not finish and removes the `lp-swap` flash guard as a backstop; cycles the highlighted row of the "stuck" table (only while on screen, tab visible, motion allowed). | `lp2-script` embed, first |
| `page.js` | Removes the shared FAQ pricing item that does not apply here and opens the first FAQ item if none is open after load; sets image `sizes` on the founder cut-out; replaces the revenue headline `<br>` with a wide-screen-only break; makes the comparison table a labelled, focusable region only when it scrolls sideways. | `lp2-script` embed, second |
| `links.js` | Re-applies the nav button label; gives icon-only links the visible label of their button as an accessible name; carries `utm_*` and `fbclid` onto `/quiz` links; for signed-out visitors, sends the Access brilliance links to `/quiz` (original `href` kept in `data-lp-orig-href` and restored for members). | `lp2-script` embed, third |
| `how-it-works.js` | How it works panels: fills the three panels with coded scenes, adds a play / pause ring per panel and steps through them (one at a time side by side, on scroll when stacked, final frame with reduced motion). | `lp2-app` embed |

Each file is an IIFE with an init guard (`window.__lp2StuckInit`, `__lp2PageInit`, `__lp2LinksInit`,
`__lp2HowInit`), so a second copy on the page does nothing.

## Contracts with the inline embeds

The inline part of the `lp2-script` embed defines these before the page paints; the files read them.

- `window.__lp2Variants`: the ad variants keyed by `utm_content` (`hire-zach`, `consult-liz`, `paid-social`,
  `retail`, `playbook`). Each has `h` (headline HTML), `cta` (hero button label), `op` (the operator shown first in
  the hero strip) and `pains` (which pain cards come first, `''` for none).
- `window.__lp2Pains`: maps `utm_content` to a pain key, derived from `__lp2Variants`. `stuck.js` falls back to it
  when `window.__lp2` is missing.
- `window.__lp2Key()`: the current known ad value, or `''`.
- `window.__lp2Set('h' | 'cta')`: writes the variant headline or CTA label, keeps the default in `data-lp-def`, and
  marks the element `data-lp-set`. Two one-line embeds call it, one right after the h1 and one before the price
  line, so the right text is there when the hero is first painted.
- `window.__lp2Nav()`: relabels the signed-out nav button to "Start your $1 trial". It is called inline once and
  again by `links.js`.
- `window.__lp2`: set by the `lp2-hero` embed, `{ variant(), applyHero(), done }`. `stuck.js` calls `applyHero()`
  only when `done` is false.
- `html.lp-swap`: added inline only for a known ad value. The page CSS hides the headline, the CTA label and the
  hero strip until each has `data-lp-set`, with a 1.5s fail-open per element, so the default never flashes and the
  guard never sticks. The inline hero swap (`lp2-hero`) removes the class; `stuck.js` removes it again only as a
  backstop.
- `html.lp-how-coded`: added inline by `lp2-app` when container query units work; the panel CSS depends on it.
  `how-it-works.js` exits if the class is absent and removes it if the markup does not match. The inline part also
  removes it on `load` if `how-it-works.js` never ran, so the static panels come back.

## What stays inline, and why

| Inline code | Embed | Why |
| --- | --- | --- |
| `__lp2Variants`, `__lp2Key`, `__lp2Set`, the `lp-swap` guard, `__lp2Nav` and its first call | `lp2-script` (top) | Runs while the page is parsed, before first paint. |
| The two `__lp2Set` writers | own embeds after the h1 and before the price line | Must run the moment those elements exist. |
| Hero swap and the Access brilliance lead tab and tab names | `lp2-hero` | Swaps the hero strip before first paint. Its DOMContentLoaded listener has to be registered before the shared Access brilliance script's. |
| Membership Monthly / Yearly price line, heading word and toggle highlight | `lp2-mem` | Price correctness. Memberstack switches the plan on click with or without this code; if the code were missing, the visitor would see Yearly selected with the monthly price. |
| "Brands your size" tabs, highlight, mix odometer, plan cards and photo preload | `lp2-size` | The tabs are real buttons; if the code were missing they would look clickable and do nothing. |
| `CSS.supports` check and `html.lp-how-coded` | `lp2-app` (a few lines) | Sets the coded panel box before first paint. |
| Comparison accordion | `lp2-compare` | Adds `html.lp-acc-js` before first paint and owns its own fallback. If it were split out, a failed file would leave closed panels. |
| Vetting wide portrait swap | `lp2-page-overrides` | The CSS hides that image until this has run; a failed file would leave it hidden. |
| All CSS | every embed | Page styles. |

## If a file does not load

Each file fails on its own; the others and all inline code keep working.

| File | What the visitor sees if it does not load |
| --- | --- |
| `stuck.js` | Pain cards in the default order, whatever the ad. The stuck table keeps a static highlight on the first row. The hero is unaffected, because the inline swap already ran and removed `lp-swap`. |
| `page.js` | The shared FAQ pricing item stays visible and no FAQ item is opened by default. The founder cut-out uses Webflow's default `sizes`. The revenue headline keeps its line break on phones. The comparison table is not a focusable region. |
| `links.js` | Ad attribution is lost: `/quiz` links lose `utm_*` and `fbclid`, and the Access brilliance links go to `/learn` and `/hire` instead of `/quiz`. Icon-only links have no accessible name. The nav label is still set by the inline call. This is an accepted risk. |
| `how-it-works.js` | The three How it works panels show their static images; there are no play / pause rings. |

## Load order and timing

- Load these files with `defer`, never `async`. `page.js` removes the FAQ pricing item and `how-it-works.js`
  finds the panels at the moment the file runs, which needs the whole document parsed. `async` could run them before
  the elements exist.
- The `lp2-script` embed loads `stuck.js`, `page.js` and `links.js` in that order. `stuck.js` goes first because it
  is the flash-guard backstop. `lp2-app` loads `how-it-works.js`.
- Deferred scripts run after the document is parsed, in document order, before `DOMContentLoaded`, with
  `document.readyState === 'interactive'`. Each file then runs at once.
- A file that is slow to arrive delays `DOMContentLoaded` for everything queued behind it. This is inherent to
  `defer`. The hero stays correct from first paint because it is inline.
- These files now run before the site's footer scripts that are also deferred. When this code was inline, it ran
  after them, at `DOMContentLoaded`. There is no visible difference today, but if a footer script ever relabels or
  re-hrefs the same links or nav button, the footer script would now win.

## Where the embeds live

Webflow site "The Starters 3.0", page "Landing Page 2 (Direct)" (`/lp2`). Each Code Embed element is labelled with a
first-line comment `/* LP2: <name> */`: `lp2-script`, `lp2-hero`, `lp2-app`, `lp2-size`, `lp2-mem`,
`lp2-page-overrides`, `lp2-compare`, `lp2-stuck`, `lp2-sticky`, `lp2-final`, `lp2-guarantee` and
`lp2-compare-mark-svg`, plus the two one-line writer embeds. The commented source of each embed is kept outside this
repo; what Webflow holds is that source with comments removed.

Script tags in the embeds:

```html
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@vX.Y.Z/lp2/stuck.js" defer></script>
```

## Testing on Staging

1. Run `./dev-tunnel.sh` from the workspace root and point the embed script tags at
   `https://<tunnel host>/<path to this checkout>/lp2/<file>.js`.
2. Publish to the `webflow.io` staging domain only. Open `/lp2` with and without `?utm_content=hire-zach` (and the
   other ad values) at 390, 768 and 1440, both cold and with a warm cache.
3. Check:
   - the hero shows the ad headline, CTA and first operator from the first frame;
   - the pain cards lead with the ad's pains;
   - the stuck table cycles;
   - the revenue tabs, odometer and plan photos switch;
   - Monthly / Yearly updates the price and heading;
   - the three How it works panels play, pause and replay;
   - `/quiz` links carry the ad tags;
   - the page never scrolls sideways;
   - the console shows no errors from these files.
4. Block each file in turn (for example with DevTools request blocking) and check the page matches the table above.
5. Put the embeds back to their released script tags before leaving Staging.
