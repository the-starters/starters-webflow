# Inter variable font subsets

Split the existing Webflow Inter font into common characters and remaining characters. The union preserves all original codepoints (counts are generated in [manifest.json](manifest.json)) and both weight (100–900) and optical-size (14–32) axes. Default character advances and side bearings match the source font.

Common text transfers about 110 KB less. Text using both subsets transfers about 19 KB more than the original. Exact byte sizes and content hashes are generated in [manifest.json](manifest.json). Unicode ranges are disjoint. This is a transfer optimization, not a claimed LCP improvement. Both faces retain font-display: swap.

This is the independently deliverable font workflow; it does not complete the other homepage performance recommendations. After the release sequence in the [repository README](../../../README.md#sync-safety), back up the exact Webflow site-head content and add a stylesheet link to `https://cdn.jsdelivr.net/gh/the-starters/starters-webflow@latest/assets/fonts/inter/inter-subsets.css` after the native Webflow styles. Read back the saved head, confirm the additive link and preserved existing content, then publish the whole site and verify the production stylesheet and font bytes. It uses the same Inter Variable family and face descriptors, so the later subset faces take precedence for their unicode ranges. The original face remains the fallback if a subset fails to load. Verify the target page requests subsets rather than the original before accepting deployment. Do not preload either subset.

The source font is retained for reproducibility. Modified fonts and source are distributed under OFL.txt. Binary output filenames include their content hashes; do not overwrite them with different bytes.

Local browser diagnostic covered weights 100, 400, 700, 900 at sizes 14 and 32, including accented text, combining marks, punctuation, currencies and ligatures. All faces were loaded and all eight text pairs had identical width and height. Published page testing remains required.

Rollback: remove the added stylesheet link from Webflow site head and publish. The native font declaration remains unchanged.

## Rebuild

Use Python 3 and a virtual environment, install requirements.txt, then run `python assets/fonts/inter/build.py`. The builder checks the source hash, each subset’s codepoint coverage, axes and default metrics, and the combined coverage and disjoint ranges. It writes generated assets during the build, so a failed build must not be released. Source timestamps are preserved for deterministic output. To check reproducibility, rebuild with the pinned dependencies and inspect `git diff --exit-code -- assets/fonts/inter` plus `git status --short -- assets/fonts/inter`; both must show no generated changes or new hash filenames. Remove obsolete generated hash filenames only when nothing references them.

The same-family browser test retained the original face before the subset faces. Common text requested only the common subset; the original and extended faces remained unloaded. This verifies the CSS precedence needed for installation without deleting Webflow's existing font.
