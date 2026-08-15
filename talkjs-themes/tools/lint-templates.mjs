// Pre-PUT lint for TalkJS theme templates.
//
//   node talkjs-themes/tools/lint-templates.mjs [themes-dir]
//
// Also importable: `lintThemes(dir, names)` returns a list of problems, and
// promote-to-real.mjs and put-clones.mjs both run it before they write. It has
// to be here rather than only in staging-qa/ for the same reason the rest of
// this folder moved: the tool that writes the LIVE theme names must carry at
// least the gates the tool that writes the QA clones carries, and it cannot
// depend on a script that only exists on one laptop.
//
// The trap, which cost two debugging rounds during the geometry round: TalkJS
// parses the WHOLE .template file, comments included. A comment that mentions
// a tag — `/hire/<slug>`, "as a <span>" — opens an element that is never
// closed. The theme fails to compile with `Unexpected close tag` pointing at
// the LAST line of the file, and TalkJS then silently serves its DEFAULT theme
// instead of erroring anywhere visible. Promoted to the real names, that is
// every member losing the entire chat design at once, with nothing in the
// console to explain it.
//
// So: inside any comment, a `<` followed by a letter or a slash is an error.
// Outside comments it is ordinary markup and is left alone.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { REPO_THEMES_DIR } from './lib.mjs';

function commentRanges(source) {
  const ranges = [];
  const push = (re) => {
    let m;
    while ((m = re.exec(source))) ranges.push([m.index, m.index + m[0].length, m[0]]);
  };
  push(/<!--[\s\S]*?-->/g);
  push(/\/\*[\s\S]*?\*\//g);
  return ranges;
}

/**
 * Lint the given theme folders (default: every directory in `dir`).
 * Returns an array of human-readable problem strings; empty means clean.
 */
export function lintThemes(dir, names) {
  const problems = [];
  const themes = names || readdirSync(dir).filter((d) => statSync(join(dir, d)).isDirectory());
  for (const theme of themes) {
    const themeDir = join(dir, theme);
    if (!existsSync(themeDir) || !statSync(themeDir).isDirectory()) continue;
    for (const file of readdirSync(themeDir)) {
      if (!file.endsWith('.template')) continue;
      const path = join(themeDir, file);
      const source = readFileSync(path, 'utf8');
      for (const [start, , text] of commentRanges(source)) {
        // The comment's own opener is not a nested tag.
        const body = text.startsWith('<!--') ? text.slice(4, -3) : text;
        const offset = text.startsWith('<!--') ? 4 : 0;
        let m;
        const re = /<\/?[A-Za-z]/g;
        while ((m = re.exec(body))) {
          const at = start + offset + m.index;
          const line = source.slice(0, at).split('\n').length;
          problems.push(
            `${theme}/${file}:${line}  ${JSON.stringify(source.slice(at, at + 40).split('\n')[0])} — ` +
              `a tag inside a comment; TalkJS will fail to compile this theme and silently serve its default instead`
          );
        }
      }
    }
  }
  return problems;
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || REPO_THEMES_DIR;
  const problems = lintThemes(dir);
  if (problems.length) {
    console.error('TEMPLATE LINT FAILED:');
    problems.forEach((p) => console.error('  ' + p));
    process.exit(1);
  }
  console.log(`template lint: no tags inside comments (${dir})`);
}
