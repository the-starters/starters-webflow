# CONTEXT

Glossary of terms used across this repo. Definitions only; implementation
details and file inventories live with the code.

**Debugger-quiet.** A script is debugger-quiet when, with "Pause on caught
exceptions" enabled in DevTools, it triggers zero pauses during normal
operation, and every stack-trace frame it contributes is named.

## Starter expertise

**Category**:
A top-level expertise group a Starter belongs to, such as Paid Media or Creative.
_Avoid_: subcategory, vertical, lvl0

**Subcategory**:
The leaf label of a Starter's hierarchical path: "Performance Creative Strategy"
from "Paid Media > Performance Creative Strategy".
_Avoid_: category, lvl1, child category, hierarchical value

**Hierarchical path**:
The full Parent > Child string for a Starter's subcategory membership.
_Avoid_: category string, facet value

**Learn Category**:
A Learn-content CMS category, such as the slug `ai-technology`. Not a Starter's
expertise Category.
_Avoid_: category, subcategory

## Motion surfaces

**Logo Wall**:
A CMS-backed social-proof band of brand logos. It may move with Marquee UX; it
is not the testimonials strip and does not share that strip's engine.
_Avoid_: logo ticker, logo cloud, logo marquee, testimonials marquee

**Marquee**:
A continuously looping horizontal track of items that never snaps to a rest
position. Distinct from the marquee-card empty company slot, which is not motion.
_Avoid_: carousel, swiper, slider, marquee-card

**Track**:
One horizontal row inside a Logo Wall or the testimonials strip.
_Avoid_: row, slider, wrapper, list
