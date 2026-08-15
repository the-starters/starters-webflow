// Shared helpers for the TalkJS themes-as-code pipeline.
//
// This is the canonical copy. It lives in the repo (not in staging-qa) because
// export/restore/promote are release-critical: a rollback that exists on one
// laptop only is not a rollback. The secret key is read from the environment
// and is never logged, written to disk, or embedded in anything this module
// produces.
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

export const APP_ID = 'LmYV8DIA';

// Paths are derived from this file's own location so a fresh clone works
// anywhere, and each one has an environment override for odd layouts.
//   <repo>/talkjs-themes/tools/lib.mjs  ->  THEMES_DIR = <repo>/talkjs-themes
const TOOLS_DIR = dirname(fileURLToPath(import.meta.url));
export const REPO_THEMES_DIR = process.env.TALKJS_THEMES_DIR
  ? resolve(process.env.TALKJS_THEMES_DIR)
  : dirname(TOOLS_DIR);
// Snapshots live beside the checkout, in the workspace's `.scratch/`. Resolve
// that from git's COMMON dir rather than from this file's path: run from a
// worktree in /tmp, the plain path walk would invent a snapshot directory
// under /tmp and quietly find no snapshots. Every worktree must see the one
// real snapshot directory, because snapshots describe the account, not a branch.
function workspaceRoot() {
  try {
    const commonDir = execFileSync(
      'git',
      ['-C', REPO_THEMES_DIR, 'rev-parse', '--path-format=absolute', '--git-common-dir'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
    if (commonDir) return dirname(dirname(commonDir)); // <root>/.git -> <root> -> parent
  } catch {
    /* not a git work tree; fall through */
  }
  return dirname(dirname(REPO_THEMES_DIR));
}
export const SNAPSHOT_DIR = process.env.TALKJS_SNAPSHOT_DIR
  ? resolve(process.env.TALKJS_SNAPSHOT_DIR)
  : join(workspaceRoot(), '.scratch', 'talkjs-chat-theme');

export const SNAPSHOT_GLOB_PREFIX = 'full-themes-backup-';

function key() {
  const k = process.env.TALKJS_SECRET_KEY;
  if (!k) throw new Error('Missing TALKJS_SECRET_KEY (run with: node --env-file=.env …)');
  return k;
}

export async function getThemes() {
  const res = await fetch(`https://api.talkjs.com/v1/${APP_ID}/themes`, {
    headers: { Authorization: `Bearer ${key()}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET themes failed: HTTP ${res.status} ${text.slice(0, 300)}`);
  return { text, json: JSON.parse(text) };
}

export async function putThemes(payload) {
  const res = await fetch(`https://api.talkjs.com/v1/${APP_ID}/themes`, {
    method: 'PUT',
    headers: {
      Authorization: `Bearer ${key()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  const text = await res.text();
  return { status: res.status, ok: res.ok, text };
}

// --- repo folder <-> API payload ------------------------------------------

// The API returns each theme as { base, files: { "<name>": "<contents>" } }.
// On disk that becomes talkjs-themes/<theme>/<name> for each file, plus a
// theme.json holding every non-`files` key (currently just `base`).
export function writeThemeToDisk(dir, name, theme) {
  const target = join(dir, name);
  mkdirSync(target, { recursive: true });
  const { files, ...meta } = theme;
  writeFileSync(join(target, 'theme.json'), JSON.stringify(meta, null, 2) + '\n');
  for (const [file, contents] of Object.entries(files)) {
    writeFileSync(join(target, file), contents);
  }
  return Object.keys(files);
}

// Files the folder format owns; they are never theme files.
const NON_THEME_FILES = new Set(['theme.json', 'README.md']);

// Which files in a theme folder are tracked by git? Returns null when the
// folder is not inside a git work tree (a bare copy in /tmp, say), in which
// case the caller falls back to the filtered directory listing.
function gitTrackedFiles(target) {
  try {
    const out = execFileSync('git', ['-C', target, 'ls-files', '-z', '--', '.'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const names = out.split('\0').filter(Boolean);
    // Only direct children matter; the format is one flat folder per theme.
    return new Set(names.filter((n) => !n.includes('/')));
  } catch {
    return null;
  }
}

/**
 * `git status --porcelain` for one theme folder, parsed.
 *
 * Returns `[{ code, path }]`, or null when the folder is not in a git work
 * tree. `code` is the two-character XY status: `??` is untracked, ` M` is
 * modified-not-staged, `M ` is staged-not-committed, ` D` is a tracked file
 * deleted from disk, and so on.
 *
 * This is what lets "only committed content ships" be a fact rather than a
 * slogan: tracked-ness alone (`ls-files`) says nothing about whether the bytes
 * on disk match the commit that the evidence file will name.
 */
export function gitStatusFor(target) {
  let out;
  try {
    out = execFileSync('git', ['-C', target, 'status', '--porcelain', '-z', '--', '.'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return null;
  }
  const parts = out.split('\0');
  const entries = [];
  for (let i = 0; i < parts.length; i++) {
    const raw = parts[i];
    if (!raw) continue;
    const code = raw.slice(0, 2);
    entries.push({ code, path: raw.slice(3) });
    // A rename/copy entry is followed by its source path as a separate record.
    if (code[0] === 'R' || code[0] === 'C') i++;
  }
  return entries;
}

/**
 * Build a theme's PUT payload from its folder.
 *
 * Two filters, because the filesystem is not the source of truth — git is:
 *
 *  1. Dotfiles are always skipped. A Finder visit drops `.DS_Store` into the
 *     folder; without this it becomes a "theme file" and either ships as junk
 *     or 400s the PUT. `.gitignore` does not help — this reads the disk.
 *  2. When the folder is inside a git work tree, untracked files are skipped
 *     too, so only reviewed, committed content can ever be pushed.
 *
 * Anything skipped is reported on `.skipped` so the caller can print it rather
 * than silently dropping a file the operator meant to add.
 */
export function readThemeFromDisk(dir, name) {
  const target = join(dir, name);
  const meta = JSON.parse(readFileSync(join(target, 'theme.json'), 'utf8'));
  const tracked = gitTrackedFiles(target);
  const files = {};
  const skipped = [];
  for (const entry of readdirSync(target).sort()) {
    if (NON_THEME_FILES.has(entry)) continue;
    if (entry.startsWith('.')) {
      skipped.push({ entry, why: 'dotfile' });
      continue;
    }
    if (statSync(join(target, entry)).isDirectory()) {
      skipped.push({ entry, why: 'directory' });
      continue;
    }
    if (tracked && !tracked.has(entry)) {
      skipped.push({ entry, why: 'untracked by git' });
      continue;
    }
    files[entry] = readFileSync(join(target, entry), 'utf8');
  }
  const theme = { ...meta, files };
  // Non-enumerable so it never leaks into JSON.stringify(payload) or a diff.
  Object.defineProperty(theme, 'skipped', { value: skipped, enumerable: false });
  return theme;
}

// --- snapshots -------------------------------------------------------------

/**
 * Every `full-themes-backup-*.json` in the snapshot directory, newest first.
 * Sorted by mtime, not by the date in the filename, so a re-taken snapshot
 * cannot be shadowed by a stale one with a later-looking name.
 */
export function listSnapshots(dir = SNAPSHOT_DIR) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith(SNAPSHOT_GLOB_PREFIX) && f.endsWith('.json'))
    .map((f) => ({ path: join(dir, f), mtime: statSync(join(dir, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);
}

/**
 * Resolve which snapshot to use, in priority order:
 *   1. an explicit path (`--snapshot <path>`, passed in by the caller)
 *   2. $TALKJS_SNAPSHOT
 *   3. the newest `full-themes-backup-*.json` in the snapshot directory
 *
 * Point 3 is deliberate: the old code hardcoded one dated filename, so an
 * operator who followed the README and wrote a fresh `…-<date>.json` silently
 * kept restoring and exporting the *old* one.
 */
export function resolveSnapshotPath(explicit) {
  const chosen = explicit || process.env.TALKJS_SNAPSHOT;
  if (chosen) return resolve(chosen);
  const found = listSnapshots();
  return found.length ? found[0].path : null;
}

/** Pull `--snapshot <path>` out of an argv slice. */
export function snapshotArg(args) {
  const i = args.indexOf('--snapshot');
  return i !== -1 ? args[i + 1] : undefined;
}

/**
 * Load a snapshot, announcing which file it picked. Loudly, every time: the
 * whole class of bug here is a tool quietly acting on the wrong snapshot.
 */
export function loadBackup(explicit) {
  const path = resolveSnapshotPath(explicit);
  if (!path) {
    throw new Error(
      `No theme snapshot found in ${SNAPSHOT_DIR} (looked for ${SNAPSHOT_GLOB_PREFIX}*.json).\n` +
        `  Take one:  node --env-file=.env talkjs-themes/tools/get-themes.mjs\n` +
        `  Or recover from the committed folder instead: talkjs-themes/tools/promote-to-real.mjs`
    );
  }
  if (!existsSync(path)) throw new Error(`No snapshot at ${path}`);
  const json = JSON.parse(readFileSync(path, 'utf8'));
  console.error(`snapshot: ${path} (${Object.keys(json).length} themes)`);
  return json;
}

/**
 * `loadBackup` for command-line use: prints the (actionable) message and exits
 * 1 instead of dumping a stack trace at an operator who is mid-incident.
 */
export function mustLoadBackup(explicit) {
  try {
    return loadBackup(explicit);
  } catch (e) {
    console.error(`\n${e.message}\n`);
    process.exit(1);
  }
}

/** Write a snapshot into the snapshot directory and return its path. */
export function writeSnapshot(json, { suffix = '', dir = SNAPSHOT_DIR } = {}) {
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const path = join(dir, `${SNAPSHOT_GLOB_PREFIX}${stamp}${suffix}.json`);
  writeFileSync(path, JSON.stringify(json, null, 2) + '\n');
  return path;
}

// --- comparison ------------------------------------------------------------

// Deterministic deep comparison that reports the exact differing path.
export function diffThemes(a, b, path = '') {
  const out = [];
  if (typeof a === 'string' || typeof b === 'string' || a === null || b === null) {
    if (a !== b) out.push(`${path || '<root>'}: differs`);
    return out;
  }
  const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
  for (const k of [...keys].sort()) {
    if (!(k in (a || {}))) out.push(`${path}/${k}: only in B`);
    else if (!(k in (b || {}))) out.push(`${path}/${k}: only in A`);
    else out.push(...diffThemes(a[k], b[k], `${path}/${k}`));
  }
  return out;
}

/** The git commit the theme folders were read at, for evidence files. */
export function themesGitHead(dir = REPO_THEMES_DIR) {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    return null;
  }
}
