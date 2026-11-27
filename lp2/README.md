# /lp2 scripts

Behaviour for the paid landing page at `/lp2` ("Landing Page 2 (Direct)"). The page is built in Webflow; its
styles and the code that must run before first paint stay in Code Embeds on that page. The files here hold the
rest of its JavaScript, loaded with `defer` from those embeds.

Everything is page-scoped: nothing here is installed in the site head or footer, and every selector is scoped to
`[data-lp-page]` or an `lp-*` section of this page.

## Files

| File | What it does | Loaded from |
| --- | --- | --- |
| `stuck.js` | Reorders the pain cards so the ones matching the ad come first; re-runs the hero swap if the inline one did not finish; lifts the `lp-swap` flash guard; cycles the highlighted row of the "stuck" table (only while on screen, tab visible, motion allowed). | `lp2-script` embed, first |
| `page.js` | Removes the shared FAQ pricing item that does not apply here and opens the first FAQ item if none is open after load; sets image `sizes` on the founder cut-out; replaces the revenue headline `<br>` with a wide-screen-only break; makes the comparison table a labelled, focusable region only when it scrolls sideways. | `lp2-script` embed, second |
| `links.js` | Re-applies the nav button label; gives icon-only links the visible label of their button as an accessible name; carries `utm_*` and `fbclid` onto `/quiz` links; for signed-out visitors, sends the Access brilliance links to `/quiz` (original `href` kept in `data-lp-orig-href` and restored for members). | `lp2-script` embed, third |
| `size.js` | "Brands your size" section: revenue tabs (ARIA tabs, arrow keys, Home, End), the sliding highlight, the mix bar odometer, the plan cards, and a preload of the four operator photos once the section is within 600px. | `lp2-script` embed, fourth |
| `membership.js` | Membership section Monthly / Yearly toggle: follows Memberstack's selected plan to update the price line, the heading word (keeping the monthly line breaks) and the toggle highlight. | `lp2-script` embed, fifth |
| `how-it-works.js` | How it works panels: fills the three panels with coded scenes, adds a play / pause ring per panel and steps through them (one at a time side by side, on scroll when stacked, final frame with reduced motion). | `lp2-app` embed |

Each file is an IIFE with an init guard (`window.__lp2StuckInit`, `__lp2PageInit`, `__lp2LinksInit`,
`__lp2SizeInit`, `__lp2MembershipInit`, `__lp2HowInit`), so a second copy on the page does nothing.

## Contracts with the inline embeds

The inline part of the `lp2-script` embed defines these before the page paints; the files read them.

- `window.__lp2Variants` — the ad variants keyed by `utm_content` (`hire-zach`, `consult-liz`, `paid-social`,
  `retail`, `playbook`): `h` (headline HTML), `cta` (hero button label), `op` (operator shown first in the hero
  strip), `pains` (which pain cards come first, `''` for none).
- `window.__lp2Pains` — `utm_content` → pain key, derived from `__lp2Variants`. `stuck.js` falls back to it when
  `window.__lp2` is missing.
- `window.__lp2Key()` — the current known ad value, or `''`.
- `window.__lp2Set('h' | 'cta')` — writes the variant headline or CTA label, keeps the default in `data-lp-def`,
  marks the element `data-lp-set`. Called by two one-line embeds placed right after the h1 and before the price
  line, so the right text is there when the hero is first painted.
- `window.__lp2Nav()` — relabels the signed-out nav button to "Start your $1 trial". Called inline once and again by
  `links.js`.
- `window.__lp2` — set by the `lp2-hero` embed: `{ variant(), applyHero(), done }`. `stuck.js` calls
  `applyHero()` only when `done` is false.
- `html.lp-swap` — added inline only for a known ad value. The page CSS hides the headline, the CTA label and the
  hero strip until each has `data-lp-set`, with a 1.5s per-element fail-open, so the default never flashes and the
  guard never sticks. `stuck.js` removes the class.
- `html.lp-how-coded` — added inline by `lp2-app` when container query units work; the panel CSS depends on it.
  `how-it-works.js` exits if it is absent and removes it if the markup does not match. The inline part also removes
  it on `load` if `how-it-works.js` never ran, so the static panels come back.

## What stays inline, and why

| Inline code | Embed | Why |
| --- | --- | --- |
| `__lp2Variants`, `__lp2Key`, `__lp2Set`, the `lp-swap` guard, `__lp2Nav` and its first call | `lp2-script` (top) | Run while the page is parsed, before first paint. |
| The two `__lp2Set` writers | own embeds after the h1 and before the price line | Must run the moment those elements exist. |
| Hero swap and the Access brilliance lead tab | `lp2-hero` | Swaps the hero strip before first paint; its DOMContentLoaded listener has to be registered before the shared Access brilliance script's. |
| `CSS.supports` check and `html.lp-how-coded` | `lp2-app` (a few lines) | Sets the coded panel box before first paint. |
| Comparison accordion | `lp2-compare` | Adds `html.lp-acc-js` before first paint and owns its own fallback; split, a failed file would leave closed panels. |
| Vetting wide portrait swap | `lp2-page-overrides` | The CSS hides that image until this has run; a failed file would leave it hidden. |
| All CSS | every embed | Page styles. |

## Load order

The `lp2-script` embed loads `stuck.js`, `page.js`, `links.js`, `size.js`, `membership.js` in that order, each with
`defer`. Deferred scripts run after the document is parsed, in document order, before `DOMContentLoaded`, with
`document.readyState === 'interactive'`; each file then runs at once (it only waits for `DOMContentLoaded` if it
was loaded some other way while the document was still loading). `stuck.js` goes first because it lifts the flash
guard. The order otherwise matches the original inline init order closely enough that no file depends on another.

If one file fails to load, the others still run, and the page keeps its Webflow defaults for that part (the flash
guard still opens after 1.5s on its own).

## Where the embeds live

Webflow site "The Starters 3.0", page "Landing Page 2 (Direct)" (`/lp2`), Code Embed elements labelled with a
first-line comment `/* LP2: <name> */`: `lp2-script`, `lp2-hero`, `lp2-app`, `lp2-size`, `lp2-page-overrides`,
`lp2-compare`, `lp2-mem`, `lp2-stuck`, `lp2-sticky`, `lp2-final`, `lp2-guarantee`, `lp2-compare-mark-svg`, plus the
two one-line writer embeds. The commented source of each embed is kept outside this repo; what Webflow holds is that
source with comments removed.

Script tags in the embeds:

```html
<script src="https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@vX.Y.Z/lp2/stuck.js" defer></script>
```

## Testing on Staging

1. Run `./dev-tunnel.sh` from the workspace root and point the embed script tags at
   `https://<tunnel host>/<path to this checkout>/lp2/<file>.js`.
2. Publish to the `webflow.io` staging domain only, then open `/lp2` with and without `?utm_content=hire-zach`
   (and the other ad values) at 390, 768 and 1440, cold and with a warm cache.
3. Check: the hero shows the ad headline, CTA and first operator from the first frame; the pain cards lead with
   the ad's pains; the stuck table cycles; the revenue tabs, odometer and plan photos switch; Monthly / Yearly
   updates the price and heading; the three How it works panels play, pause and replay; `/quiz` links carry the
   ad tags; the page never scrolls sideways; the console shows no errors from these files.
4. Put the embeds back to their released script tags before leaving Staging.
