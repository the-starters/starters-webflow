// Disaster recovery: re-PUT themes from a snapshot.
//
//   cd staging-qa
//   unset PLAYWRIGHT_BROWSERS_PATH
//   node --env-file=.env ../starters-webflow/talkjs-themes/tools/restore.mjs the-starters-3-0 --confirm
//   node --env-file=.env ../starters-webflow/talkjs-themes/tools/restore.mjs --all --confirm
//   … --snapshot <path>   restore from a specific snapshot (default: the newest)
//
// Prefer naming the themes that are actually wrong over `--all`: `--all`
// reverts every unrelated theme to snapshot state, so a recovery can end up
// with a wider blast radius than the incident it is fixing.
//
// Exit codes: 0 dry run or verified success, 1 aborted / nothing written,
// 2 a PUT was sent but the outcome could not be established, 3 live is wrong.
//
// If there is NO snapshot at all, this tool cannot help you — the committed
// folder is the fallback and `promote-to-real.mjs` is the tool for it.
import { mustLoadBackup, putThemes, getThemes, diffThemes, snapshotArg, resolveSnapshotPath, SNAPSHOT_DIR } from './lib.mjs';

const argv = process.argv.slice(2);
const KNOWN = new Set(['--all', '--yes', '--confirm', '--snapshot']);
const names = [];
let all = false;
let confirm = false;
let snapshot;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--snapshot') {
    snapshot = argv[++i];
    if (!snapshot || snapshot.startsWith('--')) {
      console.error('ABORT — --snapshot needs a path.');
      process.exit(1);
    }
  } else if (a === '--all') all = true;
  else if (a === '--yes' || a === '--confirm') confirm = true; // both words, on purpose
  else if (a.startsWith('--')) {
    console.error(`ABORT — unrecognized argument: ${a}\n  known: ${[...KNOWN].join(' ')}`);
    process.exit(1);
  } else names.push(a);
}

// Echo the resolved locations. All of these can be redirected by environment
// variables set in a file nobody reads mid-incident, and restoring the wrong
// snapshot looks exactly like restoring the right one.
console.log(`restore:`);
console.log(`  snapshot dir    : ${SNAPSHOT_DIR}  [${process.env.TALKJS_SNAPSHOT_DIR ? '$TALKJS_SNAPSHOT_DIR' : 'derived'}]`);
console.log(`  $TALKJS_SNAPSHOT: ${process.env.TALKJS_SNAPSHOT || '(unset)'}`);
console.log(`  using snapshot  : ${resolveSnapshotPath(snapshotArg(argv)) || '(none found)'}`);

const backup = mustLoadBackup(snapshotArg(argv));
const targets = all ? Object.keys(backup) : names;
if (!targets.length) {
  console.error('Nothing to restore. Pass theme names or --all.');
  process.exit(1);
}
for (const n of targets) {
  if (!backup[n]) {
    console.error(`ABORT — ${n} is not in the snapshot. It holds: ${Object.keys(backup).join(', ')}`);
    process.exit(1);
  }
}

console.log(`  restoring       : ${targets.join(', ')}${all ? '  (--all: every theme in the snapshot)' : ''}`);
if (!confirm) {
  console.log('\ndry run — re-run with --confirm to actually PUT');
  process.exit(0);
}

const beforeRes = await getThemes().catch((e) => {
  console.error(`could not read the account before restoring: ${e.message}`);
  process.exit(1);
});
const before = beforeRes.json;

const payload = Object.fromEntries(targets.map((n) => [n, backup[n]]));
const res = await putThemes(payload);
console.log('PUT ->', res.status, res.text.slice(0, 200));

let after;
try {
  after = (await getThemes()).json;
} catch (e) {
  console.error(`PUT sent but the account could not be re-read (${e.message}). STATE UNVERIFIED.`);
  process.exit(2);
}

if (!res.ok) {
  const moved = diffThemes(after, before);
  if (!moved.length) {
    console.error('PUT failed; verified the account is unchanged. Nothing was written.');
    process.exit(1);
  }
  console.error(`PUT failed BUT live changed (${moved.length} difference(s)). Check the account.`);
  process.exit(3);
}

let bad = 0;
for (const n of targets) {
  const diff = diffThemes(after[n], backup[n]);
  console.log(`${n}: ${diff.length ? 'MISMATCH' : 'restored'}`);
  bad += diff.length;
}
process.exit(bad ? 3 : 0);
