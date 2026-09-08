"""Rebuild the two licensed Inter subsets from the checked-in source font."""
import hashlib
import json
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont

ROOT = Path(__file__).resolve().parent


def unicode_ranges(points):
    ranges = []
    start = end = sorted(points)[0]
    for point in sorted(points)[1:]:
        if point == end + 1:
            end = point
        else:
            ranges.append((start, end))
            start = end = point
    ranges.append((start, end))
    return ",".join(f"U+{a:X}" + (f"-{b:X}" if a != b else "") for a, b in ranges)


def build():
    manifest = json.loads((ROOT / "manifest.json").read_text())
    source = ROOT / "source.woff2"
    assert hashlib.sha256(source.read_bytes()).hexdigest() == manifest["source"]["sha256"]
    original = TTFont(source, recalcTimestamp=False)
    cmap = original.getBestCmap()
    common = {
        cp for cp in cmap
        if cp <= 255 or 0x2000 <= cp <= 0x206F
        or cp in (0x20AC, 0x2122, 0x2190, 0x2191, 0x2192, 0x2193, 0x2212)
    }
    groups = {"common": common, "extended": set(cmap) - common}
    css = "/* Inter variable font subsets. License: ./OFL.txt. Preserve native Webflow family and swap behavior. */\n"
    axes = [(a.axisTag, a.minValue, a.defaultValue, a.maxValue) for a in original["fvar"].axes]
    for name, points in groups.items():
        font = TTFont(source, recalcTimestamp=False)
        options = subset.Options()
        options.layout_features = ["*"]
        options.name_IDs = ["*"]
        options.name_legacy = True
        options.name_languages = ["*"]
        worker = subset.Subsetter(options=options)
        worker.populate(unicodes=points)
        worker.subset(font)
        assert set(font.getBestCmap()) == points
        assert [(a.axisTag, a.minValue, a.defaultValue, a.maxValue) for a in font["fvar"].axes] == axes
        for cp, glyph in font.getBestCmap().items():
            assert font["hmtx"].metrics[glyph] == original["hmtx"].metrics[cmap[cp]]
        from io import BytesIO
        buffer = BytesIO()
        font.save(buffer)
        data = buffer.getvalue()
        digest = hashlib.sha256(data).hexdigest()
        filename = f"inter-{name}-{digest[:12]}.woff2"
        (ROOT / filename).write_bytes(data)
        manifest[name] = {"file": filename, "sha256": digest, "bytes": len(data), "codepoints": len(points)}
        css += (
            '@font-face {\n  font-family: "Inter Variable";\n  font-style: normal;\n'
            '  font-weight: 100 900;\n  font-display: swap;\n'
            f'  src: url("./{filename}") format("woff2");\n'
            f'  unicode-range: {unicode_ranges(points)};\n}}\n'
        )
    assert groups["common"] | groups["extended"] == set(cmap)
    assert not groups["common"] & groups["extended"]
    (ROOT / "inter-subsets.css").write_text(css)
    (ROOT / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    build()
