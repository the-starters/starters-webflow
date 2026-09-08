# Inter variable font subsets

Split the existing Webflow Inter font into common characters and remaining characters. The union preserves all 1,020 original codepoints and both weight (100–900) and optical-size (14–32) axes. Default character advances and side bearings match the source font.

Common text loads 99,160 bytes instead of 209,292 bytes, about 110 KB less. Text using both subsets loads 228,652 bytes total, about 19 KB more than the original. Unicode ranges are disjoint. This is a transfer optimization, not a claimed LCP improvement. Both faces retain font-display: swap.

Load inter-subsets.css after the native Webflow styles. It uses the same Inter Variable family and face descriptors, so the later subset faces take precedence for their unicode ranges. The original face remains the fallback if a subset fails to load. Verify the target page requests subsets rather than the original before accepting deployment. Do not preload either subset.

The source font is retained for reproducibility. Modified fonts and source are distributed under OFL.txt. Binary output filenames include their content hashes; do not overwrite them with different bytes.

Local browser diagnostic covered weights 100, 400, 700, 900 at sizes 14 and 32, including accented text, combining marks, punctuation, currencies and ligatures. All faces were loaded and all eight text pairs had identical width and height. Published page testing remains required.

Rollback: remove the added stylesheet link from Webflow site head and publish. The native font declaration remains unchanged.

## Rebuild

Use Python 3 and a virtual environment, install requirements.txt, then run `python assets/fonts/inter/build.py`. The builder checks source hash, full codepoint coverage, disjoint ranges, axes and default metrics before writing output. Source timestamps are preserved for deterministic output. Remove obsolete generated hash filenames only when nothing references them.

The same-family browser test retained the original face before the subset faces. Common text requested only the common subset; the original and extended faces remained unloaded. This verifies the CSS precedence needed for installation without deleting Webflow's existing font.
