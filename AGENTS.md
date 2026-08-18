# AGENTS.md

## Cursor Cloud specific instructions

This repo has two independent parts with different toolchains. There is **no
running application / dev server** to start: the root files are plain browser
scripts served from jsDelivr, and `code-components/` is a parked package that is
only built, never served. "Running" the project means running the test suites
and (for `code-components/`) the build.

### Root browser CDN scripts

- Plain browser JS served from jsDelivr. **No build step, no root
  `package.json`, no dependencies to install** — Node 22 (already present) is
  all that is needed.
- Tests use Node's built-in runner. Run them exactly like CI (see
  `.github/workflows/tests.yml`): collect committed `*.test.js` via
  `git ls-files`, **exclude `code-components/`**, and **append
  `step-flow-test-dom.js`** explicitly (it predates the `*.test.js` convention
  and is otherwise missed):
  ```sh
  files=(); while IFS= read -r -d '' f; do case "$f" in code-components/*) continue;; esac; files+=("$f"); done < <(git ls-files -z '*.test.js')
  node --test "${files[@]}" step-flow-test-dom.js
  ```
- `readme-doc-links.test.js` is a coverage guard: it fails when a shipped script
  is missing from the `README.md` inventory.

### `code-components/` (parked Webflow React package)

- Has its own `package.json`, lockfile, and vitest suite. Run all commands from
  inside `code-components/`. Standard commands live in
  `code-components/README.md`: `npm ci`, `npm test` (vitest), `npm run typecheck`
  (`tsc --noEmit`), `npm run build` (`webflow devlink bundle`).
- The update script runs `npm ci` here on startup, so deps are already installed
  for future agents.
- `dist/`, `node_modules/`, and `.env` are gitignored; a successful build writes
  `dist/Client` + `dist/Server`. It is parked: do not import into Webflow, tag,
  or deploy it.

### Linting

- No linter is configured anywhere (no ESLint/Prettier config, no `lint`
  script). There is no lint step to run.
