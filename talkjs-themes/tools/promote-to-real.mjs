// Promote the committed theme folders to the REAL theme names on TalkJS.
//
// This is the only tool that writes the live theme names, and it is the last
// step of the cutover (ticket 06). A PUT lands on live instantly for every
// member — there is no Test→Publish safeguard on the API path — so the
// controller that understands the new markup must already be deployed and
// published BEFORE this runs. See the ordering note in the themes README.
//
//   cd staging-qa
//   unset PLAYWRIGHT_BROWSERS_PATH
//   node --env-file=.env ../starters-webflow/talkjs-themes/tools/promote-to-real.mjs
//   node --env-file=.env ../starters-webflow/talkjs-themes/tools/promote-to-real.mjs --confirm
//
// Flags:
//   --confirm            actually PUT (default is a dry run that prints the diff)
//   --themes a,b         override the target list (used by the self-test)
//   --dir <path>         read the theme folders from somewhere other than the repo
//   --allow-new          permit creating a theme name that does not exist yet
//   --allow-untracked    permit files git does not know about (default: refuse)
//   --evidence <dir>     where to write the evidence JSON
//
// Safety interlocks, all of them load-bearing:
//   1. A full pre-PUT snapshot of EVERY theme is written to the snapshot dir
//      and read back before anything is written. No snapshot, no --confirm.
//   2. The exact diff (folder vs live) is printed and must be confirmed. A
//      no-op promotion exits without touching the API at all.
//   3. The PUT carries each theme's COMPLETE file map. A PUT replaces a theme
//      wholesale, so a partial map deletes every file it omits.
//   4. After the PUT every promoted theme is re-read and proved byte-identical
//      to the folder, and every other theme byte-identical to the snapshot.
//   5. Only committed content ships: untracked files abort the run.
import { writeFileSync, mkdirSync, existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import {
  readThemeFromDisk,
  getThemes,
  putThemes,
  diffThemes,
  writeSnapshot,
  themesGitHead,
  REPO_THEMES_DIR,
  SNAPSHOT_DIR,
} from './lib.mjs';

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};

const confirm = flag('--confirm');
const allowNew = flag('--allow-new');
const allowUntracked = flag('--allow-untracked');
const dir = opt('--dir', REPO_THEMES_DIR);
const REAL_THEMES = ['the-starters-3-0', 'the-starters-3-0-profile'];
const targets = opt('--themes', REAL_THEMES.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const evidenceDir = opt('--evidence', join(SNAPSHOT_DIR, 'promote-evidence', stamp));

const fail = (msg) => {
  console.error(`ABORT — ${msg}`);
  process.exit(1);
};

console.log(`promote-to-real: ${targets.join(', ')}`);
console.log(`  source folders: ${dir}`);
console.log(`  git HEAD:       ${themesGitHead(dir) || '(not a git work tree)'}`);
console.log(`  mode:           ${confirm ? 'CONFIRMED — will PUT' : 'dry run'}\n`);

// --- 1. read the folders ---------------------------------------------------

const payload = {};
for (const name of targets) {
  if (!existsSync(join(dir, name, 'theme.json'))) {
    fail(`no theme folder at ${join(dir, name)} (needs theme.json)`);
  }
  const theme = readThemeFromDisk(dir, name);
  payload[name] = theme;
  const fileCount = Object.keys(theme.files).length;
  if (!fileCount) fail(`${name}/ contains no theme files — refusing to push an empty theme`);
  console.log(`  ${name}/: ${fileCount} files, base=${theme.base}`);
  for (const s of theme.skipped) {
    console.log(`     skipped ${s.entry} (${s.why})`);
  }
  const untracked = theme.skipped.filter((s) => s.why === 'untracked by git');
  if (untracked.length && !allowUntracked) {
    fail(
      `${name}/ has files git does not know about: ${untracked.map((u) => u.entry).join(', ')}.\n` +
        `  Commit them or delete them. Only reviewed content is promotable ` +
        `(--allow-untracked overrides, deliberately awkward).`
    );
  }
}

// --- 2. read live, snapshot it ---------------------------------------------

const before = (await getThemes()).json;
console.log(`\nlive account: ${Object.keys(before).length} themes`);

for (const name of targets) {
  if (!before[name] && !allowNew) {
    fail(`${name} does not exist on the account. Pass --allow-new to create it.`);
  }
}

// The snapshot itself is written just before the PUT, so a dry run never
// leaves an artifact behind. What we check here is that it will be possible:
// no writable snapshot directory, no promotion.
let snapshotPath = null;
try {
  mkdirSync(SNAPSHOT_DIR, { recursive: true });
  const probe = join(SNAPSHOT_DIR, `.promote-write-probe-${process.pid}`);
  writeFileSync(probe, 'probe');
  rmSync(probe);
  console.log(`  rollback snapshot will be written to: ${SNAPSHOT_DIR} (writable)`);
} catch (e) {
  console.error(`  snapshot directory NOT writable: ${e.message}`);
  if (confirm) fail('refusing to --confirm without somewhere to write the rollback snapshot');
}

// --- 3. diff folder vs live -------------------------------------------------

const summary = {};
let changes = 0;
let deletions = 0;

console.log('\ndiff (repo folder -> live theme):');
for (const name of targets) {
  const live = before[name];
  const next = payload[name];
  const liveFiles = live?.files || {};
  const nextFiles = next.files;

  const added = Object.keys(nextFiles).filter((f) => !(f in liveFiles)).sort();
  const removed = Object.keys(liveFiles).filter((f) => !(f in nextFiles)).sort();
  const changed = Object.keys(nextFiles)
    .filter((f) => f in liveFiles && liveFiles[f] !== nextFiles[f])
    .sort();
  const metaDiff = [];
  const liveMeta = { ...live };
  delete liveMeta.files;
  const nextMeta = { ...next };
  delete nextMeta.files;
  for (const k of new Set([...Object.keys(liveMeta), ...Object.keys(nextMeta)])) {
    if (JSON.stringify(liveMeta[k]) !== JSON.stringify(nextMeta[k])) {
      metaDiff.push(`${k}: ${JSON.stringify(liveMeta[k])} -> ${JSON.stringify(nextMeta[k])}`);
    }
  }

  summary[name] = {
    exists: Boolean(live),
    added,
    removed,
    changed,
    metaDiff,
    unchanged: Object.keys(nextFiles).length - added.length - changed.length,
  };
  changes += added.length + removed.length + changed.length + metaDiff.length;
  deletions += removed.length;

  console.log(`\n  ${name}${live ? '' : '  (NEW THEME)'}`);
  if (metaDiff.length) for (const m of metaDiff) console.log(`     meta   ${m}`);
  for (const f of added) console.log(`     +      ${f} (${nextFiles[f].split('\n').length} lines)`);
  for (const f of changed) {
    const a = liveFiles[f].split('\n').length;
    const b = nextFiles[f].split('\n').length;
    console.log(`     ~      ${f} (${a} -> ${b} lines, ${liveFiles[f].length} -> ${nextFiles[f].length} bytes)`);
  }
  for (const f of removed) console.log(`     DELETE ${f} (${liveFiles[f].split('\n').length} lines, gone after this PUT)`);
  if (!metaDiff.length && !added.length && !changed.length && !removed.length) {
    console.log('     (identical — nothing to promote)');
  }
}

if (deletions) {
  console.log(
    `\n  !! ${deletions} file(s) exist live but not in the repo folder. A PUT replaces a theme\n` +
      `     wholesale, so they WILL be deleted. If that is not intended, re-export first.`
  );
}

if (!changes) {
  console.log('\nNothing to do — every target already matches its folder. No PUT sent.');
  process.exit(0);
}

if (!confirm) {
  console.log(
    `\n${changes} change(s) across ${targets.length} theme(s). Dry run — nothing was written.\n` +
      `Re-run with --confirm to PUT. Remember: the theme goes live for every member the\n` +
      `instant it lands, so the controller must already be published (ticket 06, step 5).`
  );
  process.exit(0);
}

// --- 4. snapshot, then PUT ---------------------------------------------------

// Interlock: the rollback artifact is written and read back BEFORE the write.
try {
  snapshotPath = writeSnapshot(before, { suffix: '-pre-promote' });
  const reread = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  if (diffThemes(reread, before).length) throw new Error('read-back differs from the live response');
  console.log(`\npre-PUT snapshot: ${snapshotPath} (read back, ${Object.keys(reread).length} themes)`);
} catch (e) {
  fail(`could not write a verified pre-PUT snapshot (${e.message}) — that snapshot is the rollback`);
}

console.log('\nPUTting the complete file map for:', targets.join(', '));
const res = await putThemes(Object.fromEntries(targets.map((n) => [n, payload[n]])));
console.log('PUT ->', res.status, res.text.slice(0, 300));
if (!res.ok) {
  console.error(`\nPUT failed. The account should be untouched; the pre-PUT snapshot is ${snapshotPath}`);
  process.exit(1);
}

// --- 5. verify --------------------------------------------------------------

const after = (await getThemes()).json;
const report = {
  ranAt: new Date().toISOString(),
  sourceDir: dir,
  gitHead: themesGitHead(dir),
  targets,
  snapshotPath,
  diff: summary,
  promotedMatchesFolder: {},
  everyOtherThemeUnchanged: {},
  verdict: '',
};
let fatal = 0;

for (const name of targets) {
  if (!after[name]) {
    report.promotedMatchesFolder[name] = 'MISSING AFTER PUT';
    fatal++;
    continue;
  }
  const d = diffThemes(after[name], payload[name]);
  report.promotedMatchesFolder[name] = d.length ? d : 'byte-identical to the repo folder';
  if (d.length) fatal++;
}

for (const name of Object.keys(before)) {
  if (targets.includes(name)) continue;
  if (!after[name]) {
    report.everyOtherThemeUnchanged[name] = 'DELETED';
    fatal++;
    continue;
  }
  const d = diffThemes(after[name], before[name]);
  report.everyOtherThemeUnchanged[name] = d.length ? d : 'byte-identical to the pre-PUT snapshot';
  if (d.length) fatal++;
}
for (const name of Object.keys(after)) {
  if (!(name in before) && !targets.includes(name)) {
    report.everyOtherThemeUnchanged[name] = 'UNEXPECTED NEW THEME';
    fatal++;
  }
}

report.verdict = fatal
  ? `FAIL — ${fatal} problem(s). Roll back now: restore.mjs --all --snapshot ${snapshotPath} --yes`
  : 'PASS — targets carry the repo folder exactly, every other theme byte-identical';

mkdirSync(evidenceDir, { recursive: true });
writeFileSync(join(evidenceDir, 'promote-report.json'), JSON.stringify(report, null, 2) + '\n');
writeFileSync(join(evidenceDir, 'themes-post-put.json'), JSON.stringify(after, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
console.log(`\nevidence: ${evidenceDir}`);
process.exit(fatal ? 1 : 0);
