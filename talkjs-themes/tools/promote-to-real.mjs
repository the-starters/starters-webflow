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
// Exit codes are load-bearing — "aborted safely" and "live is now wrong" must
// never be the same number:
//
//   0  dry run, no-op, or a fully verified success
//   1  aborted before any write; the account was not touched
//   2  a PUT was sent and the outcome could NOT be established (re-read failed)
//   3  live was mutated and verification FAILED — roll back now
import { writeFileSync, mkdirSync, existsSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintThemes } from './lint-templates.mjs';
import {
  readThemeFromDisk,
  gitStatusFor,
  getThemes,
  putThemes,
  diffThemes,
  writeSnapshot,
  themesGitHead,
  REPO_THEMES_DIR,
  SNAPSHOT_DIR,
} from './lib.mjs';

const EXIT_OK = 0;
const EXIT_ABORTED = 1;
const EXIT_UNKNOWN = 2;
const EXIT_LIVE_BROKEN = 3;

const REAL_THEMES = ['the-starters-3-0', 'the-starters-3-0-profile'];
const RESTORE_SCRIPT = fileURLToPath(new URL('./restore.mjs', import.meta.url));

// --- argument parsing -------------------------------------------------------
// Unknown flags are REJECTED. `--confirm --dry-run` used to discard the
// `--dry-run` silently and write to live, which is the single most natural
// thing to type: up-arrow the rehearsal, append --dry-run, forget to delete
// --confirm.
const VALUE_FLAGS = new Set(['--themes', '--dir', '--evidence']);
const BOOL_FLAGS = new Set([
  '--confirm',
  '--yes', // alias: put-clones and restore use --yes; accept both everywhere
  '--dry-run',
  '--allow-new',
  '--allow-deletions',
  '--exclude-untracked',
  '--allow-dirty',
  '--help',
]);

const argv = process.argv.slice(2);
const opts = new Map();
const bools = new Set();
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (VALUE_FLAGS.has(a)) {
    const v = argv[++i];
    if (v === undefined || v.startsWith('--')) {
      console.error(`ABORT — ${a} needs a value.`);
      process.exit(EXIT_ABORTED);
    }
    opts.set(a, v);
  } else if (BOOL_FLAGS.has(a)) {
    bools.add(a);
  } else {
    console.error(
      `ABORT — unrecognized argument: ${a}\n` +
        `  known: ${[...VALUE_FLAGS].join(' ')} ${[...BOOL_FLAGS].join(' ')}\n` +
        `  Refusing rather than ignoring it: a silently dropped flag is how a rehearsal\n` +
        `  becomes a live write, and a stray theme name is how "just this one" becomes both.`
    );
    process.exit(EXIT_ABORTED);
  }
}

if (bools.has('--help')) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(0, 21).join('\n'));
  process.exit(EXIT_OK);
}

const wantsConfirm = bools.has('--confirm') || bools.has('--yes');
const wantsDryRun = bools.has('--dry-run');
if (wantsConfirm && wantsDryRun) {
  console.error(
    'ABORT — --confirm and --dry-run were both passed. Refusing to guess which you meant.\n' +
      '  Drop one and run it again.'
  );
  process.exit(EXIT_ABORTED);
}
const confirm = wantsConfirm;

const allowNew = bools.has('--allow-new');
const allowDeletions = bools.has('--allow-deletions');
const excludeUntracked = bools.has('--exclude-untracked');
const allowDirty = bools.has('--allow-dirty');
const dir = opts.get('--dir') || REPO_THEMES_DIR;
const targets = (opts.get('--themes') || REAL_THEMES.join(','))
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const evidenceDir = opts.get('--evidence') || join(SNAPSHOT_DIR, 'promote-evidence', stamp);
// Dry-run snapshots go in a subdirectory. Snapshot resolution is a prefix match
// on a non-recursive listing, so a rehearsal is invisible to `restore` BY
// CONSTRUCTION rather than by anyone remembering to clean up — and a rehearsal
// run AFTER a bad promotion can no longer become the newest "rollback".
const DRY_RUN_SNAPSHOT_DIR = join(SNAPSHOT_DIR, 'dry-runs');

const fail = (msg) => {
  console.error(`ABORT — ${msg}`);
  process.exit(EXIT_ABORTED);
};

// --- header: every resolved path, unconditionally ---------------------------
// All three of these can be redirected from staging-qa/.env, a file nobody
// reads at 2am. If the rollback snapshot went somewhere unexpected, the
// operator must be able to see that here rather than infer it later.
const src = (envName, flagName) =>
  opts.get(flagName) ? `--dir` : process.env[envName] ? `$${envName}` : 'default';

console.log(`promote-to-real: ${targets.join(', ')}`);
console.log(`  mode            : ${confirm ? 'CONFIRMED — will PUT to LIVE' : 'dry run'}`);
console.log(`  theme folders   : ${dir}  [${src('TALKJS_THEMES_DIR', '--dir')}]`);
console.log(`  git HEAD        : ${themesGitHead(dir) || '(not a git work tree)'}`);
console.log(
  `  snapshot dir    : ${SNAPSHOT_DIR}  [${process.env.TALKJS_SNAPSHOT_DIR ? '$TALKJS_SNAPSHOT_DIR' : 'derived'}]`
);
console.log(`  $TALKJS_SNAPSHOT: ${process.env.TALKJS_SNAPSHOT || '(unset)'}`);
console.log(`  evidence dir    : ${evidenceDir}`);
console.log('');

if (targets.length < REAL_THEMES.length && targets.every((t) => REAL_THEMES.includes(t))) {
  console.log(
    `  !! PARTIAL SELECTION — promoting ${targets.length} of the ${REAL_THEMES.length} real themes.\n` +
      `     ${REAL_THEMES.join(' backs /messages, ')} backs the profile modal. Promoting one\n` +
      `     leaves the two surfaces on different theme versions for the same member.\n`
  );
}

// --- 1. read the folders ----------------------------------------------------

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
  for (const s of theme.skipped) console.log(`     skipped ${s.entry} (${s.why})`);

  const untracked = theme.skipped.filter((s) => s.why === 'untracked by git');
  if (untracked.length && !excludeUntracked) {
    fail(
      `${name}/ has files git does not know about: ${untracked.map((u) => u.entry).join(', ')}.\n` +
        `  They would NOT ship, and if a file of that name exists live it would be DELETED.\n` +
        `  Commit them, or pass --exclude-untracked to proceed with them left out.`
    );
  }

  // "Only committed content ships" has to be enforced, not asserted. Tracked
  // says nothing about whether the bytes match the commit the report names.
  const status = gitStatusFor(join(dir, name));
  const dirty = (status || []).filter((e) => e.code !== '??');
  if (dirty.length && !allowDirty) {
    fail(
      `${name}/ is not clean at HEAD:\n` +
        dirty.map((e) => `     ${e.code}  ${e.path}`).join('\n') +
        `\n  Uncommitted edits would go live while the evidence file named a commit that\n` +
        `  does not describe them. Commit them, or pass --allow-dirty (the report will\n` +
        `  record that the promoted content does not match any commit).`
    );
  }
  if (dirty.length) console.log(`     !! ${dirty.length} uncommitted change(s), allowed by --allow-dirty`);
}

// A theme whose comments contain a tag does not compile, and TalkJS answers by
// silently serving its DEFAULT theme — every member loses the chat design at
// once, with nothing in the console. put-clones runs this before writing the
// QA clones; the tool that writes the live names must not have a weaker gate.
// There is no override: a theme that cannot compile has no valid reason to be
// promoted.
const lintProblems = lintThemes(dir, targets);
if (lintProblems.length) {
  console.error(`\nABORT — template lint failed:\n${lintProblems.map((p) => `     ${p}`).join('\n')}`);
  process.exit(EXIT_ABORTED);
}
console.log(`  template lint: clean`);

// --- 2. read live -----------------------------------------------------------

const before = (await getThemes()).json;
console.log(`\nlive account: ${Object.keys(before).length} themes`);

for (const name of targets) {
  if (!before[name] && !allowNew) {
    fail(`${name} does not exist on the account. Pass --allow-new to create it.`);
  }
}

// Probe BOTH directories now, before anything is at risk. The evidence
// directory used to be created only after the PUT, so a bad --evidence path
// threw at the one moment the record mattered most.
for (const [label, target] of [
  ['snapshot', confirm ? SNAPSHOT_DIR : DRY_RUN_SNAPSHOT_DIR],
  ['evidence', evidenceDir],
]) {
  const existedBefore = existsSync(target);
  const probe = join(target, `.promote-write-probe-${process.pid}`);
  try {
    mkdirSync(target, { recursive: true });
    writeFileSync(probe, 'probe');
  } catch (e) {
    console.error(`  ${label} directory NOT writable (${target}): ${e.message}`);
    if (confirm) fail(`refusing to --confirm without somewhere to write the ${label}`);
  } finally {
    try {
      rmSync(probe, { force: true });
      // Leave no empty directory behind for a run that writes nothing — the
      // real writes below re-create it. Walk up too, since `promote-evidence/`
      // and its timestamped child are both created by one mkdir.
      if (!existedBefore) {
        let p = target;
        while (
          p.startsWith(SNAPSHOT_DIR) &&
          p !== SNAPSHOT_DIR &&
          p !== dirname(p) &&
          existsSync(p) &&
          !readdirSync(p).length
        ) {
          rmSync(p, { recursive: true });
          p = dirname(p);
        }
      }
    } catch {
      /* best effort; the probe is 5 bytes and the directory is empty */
    }
  }
  console.log(`  ${label} dir writable: ${target}`);
}

// --- 3. diff folder vs live -------------------------------------------------

const summary = {};
let changes = 0;
const deletionsByTheme = {};
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
  if (removed.length) deletionsByTheme[name] = removed;
  deletions += removed.length;

  console.log(`\n  ${name}${live ? '' : '  (NEW THEME)'}`);
  if (metaDiff.length) for (const m of metaDiff) console.log(`     meta   ${m}`);
  for (const f of added) console.log(`     +      ${f} (${nextFiles[f].split('\n').length} lines)`);
  for (const f of changed) {
    const a = liveFiles[f].split('\n').length;
    const b = nextFiles[f].split('\n').length;
    console.log(`     ~      ${f} (${a} -> ${b} lines, ${liveFiles[f].length} -> ${nextFiles[f].length} bytes)`);
  }
  for (const f of removed) console.log(`     DELETE ${f} (${liveFiles[f].split('\n').length} lines)`);
  if (!metaDiff.length && !added.length && !changed.length && !removed.length) {
    console.log('     (identical — nothing to promote)');
  }
}

if (!changes) {
  console.log('\nNothing to do — every target already matches its folder. No PUT sent.');
  console.log('(No snapshot was written: there is nothing to roll back to or from.)');
  process.exit(EXIT_OK);
}

const deletionNotice =
  `${deletions} file(s) that exist live are absent from the folder:\n` +
  Object.entries(deletionsByTheme)
    .map(([t, fs]) => fs.map((f) => `     ${t}/${f}`).join('\n'))
    .join('\n') +
  `\n  A PUT replaces a theme wholesale, so they would be removed from the live\n` +
  `  theme. The two folders are legitimately different sizes, so this is not\n` +
  `  something to eyeball.`;

// The ordering warning belongs in the run that can cause the harm, not only in
// the one that cannot.
const ORDERING = confirm
  ? `\n${'!'.repeat(74)}\n` +
    `  THIS WRITES THE LIVE THEME. It is live for every member the instant it\n` +
    `  lands — there is no Test→Publish step on the API path.\n` +
    `  The controller that understands this markup must ALREADY be published\n` +
    `  (ticket 06, step 5). Pushing the theme first gives every member a UI\n` +
    `  wired to a controller that is not there, and TalkJS drops unhandled\n` +
    `  actions silently, so nothing will error — it will just do nothing.\n` +
    `${'!'.repeat(74)}`
  : `\nReminder: the theme goes live for every member the instant it lands, so the\n` +
    `controller must already be published (ticket 06, step 5).`;
console.log(ORDERING);

if (!confirm) {
  // A dry run is for seeing what would happen, so it reports the deletions
  // rather than refusing over them — the refusal belongs on the write path.
  if (deletions) {
    console.log(`\nDELETIONS — ${deletionNotice}`);
    console.log(`  A real run REFUSES unless you pass --allow-deletions.`);
  }
  // A rehearsal that exercises the real snapshot write, into a directory the
  // resolvers cannot see.
  let rehearsal = null;
  try {
    rehearsal = writeSnapshot(before, { suffix: '-dry-run', dir: DRY_RUN_SNAPSHOT_DIR });
    const reread = JSON.parse(readFileSync(rehearsal, 'utf8'));
    if (diffThemes(reread, before).length) throw new Error('read-back differs from the live response');
    console.log(`\nrehearsal snapshot written and read back: ${rehearsal}`);
    console.log(`  (under dry-runs/, so snapshot resolution cannot pick it up as a rollback)`);
  } catch (e) {
    console.error(`\nrehearsal snapshot FAILED: ${e.message} — a real run would abort here.`);
    process.exit(EXIT_ABORTED);
  }
  console.log(`\n${changes} change(s) across ${targets.length} theme(s). Dry run — live was not touched.`);
  console.log('Re-run with --confirm to PUT.');
  process.exit(EXIT_OK);
}

// --- 4. gate, re-read, snapshot, record, then PUT ---------------------------

// The only irreversible operation in the tool was the one without a gate,
// while both harmless ones (--allow-new, untracked files) had one. Deleting a
// live file cannot be undone from the folder — the folder is what forgot it.
if (deletions && !allowDeletions) {
  console.error(
    `\nABORT — this PUT would DELETE ${deletionNotice}\n` +
      `  If the deletions are intended, re-run with --allow-deletions.\n` +
      `  If they are not, re-export the folder first — you are promoting a stale copy.`
  );
  process.exit(EXIT_ABORTED);
}

// TOCTOU: `before` is now seconds old, and this repo has documented concurrent
// sessions. Snapshotting a stale in-memory copy would produce both a false
// "another theme changed" failure and a rollback that reverts someone else's
// legitimate write.
const justBefore = (await getThemes()).json;
const drift = diffThemes(justBefore, before);
if (drift.length) {
  fail(
    `the account changed while this tool was deciding (${drift.length} difference(s)):\n` +
      drift.slice(0, 12).map((d) => `     ${d}`).join('\n') +
      (drift.length > 12 ? `\n     …and ${drift.length - 12} more` : '') +
      `\n  Another session or a dashboard edit landed. Re-run and read the diff again.`
  );
}

let snapshotPath = null;
try {
  snapshotPath = writeSnapshot(justBefore, { suffix: '-pre-promote' });
  const reread = JSON.parse(readFileSync(snapshotPath, 'utf8'));
  if (diffThemes(reread, justBefore).length) throw new Error('read-back differs from the live response');
  console.log(`\npre-PUT snapshot: ${snapshotPath} (read back, ${Object.keys(reread).length} themes)`);
} catch (e) {
  fail(`could not write a verified pre-PUT snapshot (${e.message}) — that snapshot is the rollback`);
}

// Roll back only what this tool touched. `--all` would revert every unrelated
// theme to snapshot state, making the recovery's blast radius bigger than the
// incident's.
const restoreCmd = `node --env-file=.env ${RESTORE_SCRIPT} ${targets.join(' ')} --snapshot ${snapshotPath} --confirm`;

// Persist the plan BEFORE the risky step. Everything after this line can be
// interrupted by a dropped connection, a SIGINT from a panicking operator, or
// a process kill, and the record on disk must already name the rollback.
mkdirSync(evidenceDir, { recursive: true });
const plan = {
  ranAt: new Date().toISOString(),
  status: 'PUT_NOT_YET_SENT',
  sourceDir: dir,
  gitHead: themesGitHead(dir),
  gitHeadDescribesContent: !allowDirty,
  targets,
  snapshotPath,
  restoreCommand: restoreCmd,
  plannedDiff: summary,
  plannedDeletions: deletionsByTheme,
};
writeFileSync(join(evidenceDir, 'pre-put-plan.json'), JSON.stringify(plan, null, 2) + '\n');
writeFileSync(join(evidenceDir, 'themes-pre-put.json'), JSON.stringify(justBefore, null, 2) + '\n');
console.log(`pre-PUT record written: ${join(evidenceDir, 'pre-put-plan.json')}`);

const onSignal = (sig) => {
  console.error(
    `\n\n${sig} received. The PUT may or may not have been applied — TalkJS has no\n` +
      `transaction to abort. Do NOT assume it was cancelled.\n\n` +
      `  Check what is live:  node --env-file=.env ${fileURLToPath(new URL('./get-themes.mjs', import.meta.url))}\n` +
      `  Roll back:           ${restoreCmd}\n\n` +
      `  Pre-PUT snapshot:    ${snapshotPath}\n` +
      `  Record:              ${join(evidenceDir, 'pre-put-plan.json')}\n`
  );
  process.exit(EXIT_UNKNOWN);
};
process.on('SIGINT', () => onSignal('SIGINT'));
process.on('SIGTERM', () => onSignal('SIGTERM'));

console.log('\nPUTting the complete file map for:', targets.join(', '));
const res = await putThemes(Object.fromEntries(targets.map((n) => [n, payload[n]])));
console.log('PUT ->', res.status, res.text.slice(0, 300));

// A non-2xx does not prove nothing was written — a 502 from an intermediary
// after the origin applied the write looks exactly like this. In a tool whose
// premise is that guesses about live state are unacceptable, this must be
// checked rather than asserted.
if (!res.ok) {
  console.error('\nPUT reported failure. Verifying what is actually live rather than assuming.');
  let now;
  try {
    now = (await getThemes()).json;
  } catch (e) {
    console.error(
      `  could not re-read the account (${e.message}).\n` +
        `  STATE UNKNOWN. Check it yourself, and roll back if it moved:\n    ${restoreCmd}`
    );
    process.exit(EXIT_UNKNOWN);
  }
  const moved = diffThemes(now, justBefore);
  writeFileSync(join(evidenceDir, 'themes-post-failed-put.json'), JSON.stringify(now, null, 2) + '\n');
  if (!moved.length) {
    console.error('  verified: the account is byte-identical to the pre-PUT snapshot. Nothing was written.');
    process.exit(EXIT_ABORTED);
  }
  console.error(
    `  LIVE CHANGED DESPITE THE ERROR — ${moved.length} difference(s):\n` +
      moved.slice(0, 12).map((d) => `     ${d}`).join('\n') +
      `\n  Roll back now:\n    ${restoreCmd}`
  );
  process.exit(EXIT_LIVE_BROKEN);
}

// --- 5. verify --------------------------------------------------------------

let after;
try {
  after = (await getThemes()).json;
} catch (e) {
  console.error(
    `\nThe PUT returned ${res.status}, but the account could not be re-read (${e.message}).\n` +
      `STATE UNVERIFIED — the write probably landed but nothing has confirmed it.\n` +
      `  Check:     node --env-file=.env ${fileURLToPath(new URL('./get-themes.mjs', import.meta.url))}\n` +
      `  Roll back: ${restoreCmd}`
  );
  process.exit(EXIT_UNKNOWN);
}

const report = {
  ...plan,
  status: 'PUT_SENT',
  finishedAt: new Date().toISOString(),
  promotedMatchesFolder: {},
  everyOtherThemeUnchanged: {},
  perTheme: {},
  verdict: '',
};
let fatal = 0;

for (const name of targets) {
  if (!after[name]) {
    report.promotedMatchesFolder[name] = 'MISSING AFTER PUT';
    report.perTheme[name] = 'FAILED — the theme is not on the account after the PUT';
    fatal++;
    continue;
  }
  const d = diffThemes(after[name], payload[name]);
  report.promotedMatchesFolder[name] = d.length ? d : 'byte-identical to the repo folder';
  report.perTheme[name] = d.length
    ? `FAILED — live does not match ${name}/ (${d.length} difference(s))`
    : `promoted — live is byte-identical to ${name}/`;
  if (d.length) fatal++;
}

for (const name of Object.keys(justBefore)) {
  if (targets.includes(name)) continue;
  if (!after[name]) {
    report.everyOtherThemeUnchanged[name] = 'DELETED';
    fatal++;
    continue;
  }
  const d = diffThemes(after[name], justBefore[name]);
  report.everyOtherThemeUnchanged[name] = d.length ? d : 'byte-identical to the pre-PUT snapshot';
  if (d.length) fatal++;
}
for (const name of Object.keys(after)) {
  if (!(name in justBefore) && !targets.includes(name)) {
    report.everyOtherThemeUnchanged[name] = 'UNEXPECTED NEW THEME';
    fatal++;
  }
}

// A count is not a verdict when the two themes back two different surfaces.
const succeeded = targets.filter((n) => String(report.perTheme[n]).startsWith('promoted'));
const failed = targets.filter((n) => !String(report.perTheme[n]).startsWith('promoted'));

console.log('\nper-theme result:');
for (const name of targets) console.log(`  ${name}: ${report.perTheme[name]}`);

if (!fatal) {
  report.verdict = `PASS — ${succeeded.join(' and ')} promoted; every other theme byte-identical`;
} else if (succeeded.length && failed.length) {
  report.verdict =
    `PARTIAL — ${succeeded.join(', ')} promoted but ${failed.join(', ')} did NOT. ` +
    `/messages and the /hire profile modal are now on disagreeing theme versions: the same ` +
    `member sees one surface updated and the other not. Finish or roll back, do not leave it here.`;
} else {
  report.verdict = `FAIL — nothing verified as promoted; live may be inconsistent`;
}
report.restoreCommand = restoreCmd;

writeFileSync(join(evidenceDir, 'promote-report.json'), JSON.stringify(report, null, 2) + '\n');
writeFileSync(join(evidenceDir, 'themes-post-put.json'), JSON.stringify(after, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
console.log(`\nevidence: ${evidenceDir}`);
console.log(`\n${report.verdict}`);
if (fatal) {
  console.error(
    `\nRoll back the themes this tool touched (not --all — that would revert unrelated\n` +
      `themes to snapshot state and make the recovery worse than the incident):\n\n    ${restoreCmd}\n`
  );
}
process.exit(fatal ? EXIT_LIVE_BROKEN : EXIT_OK);
