// Disaster recovery: re-PUT themes from a snapshot.
//
//   cd staging-qa
//   unset PLAYWRIGHT_BROWSERS_PATH
//   node --env-file=.env ../starters-webflow/talkjs-themes/tools/restore.mjs --all
//   node --env-file=.env ../starters-webflow/talkjs-themes/tools/restore.mjs the-starters-3-0 --yes
//   … --snapshot <path>   restore from a specific snapshot (default: the newest)
//
// Prints the payload's theme names and waits for an explicit --yes before
// writing, because a PUT lands on live instantly (ADR 0004).
//
// If there is NO snapshot at all, this tool cannot help you — the committed
// folder is the fallback and `promote-to-real.mjs` is the tool for it.
import { mustLoadBackup, putThemes, getThemes, diffThemes, snapshotArg } from './lib.mjs';

const args = process.argv.slice(2);
const yes = args.includes('--yes');
const all = args.includes('--all');
const names = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--snapshot');

const backup = mustLoadBackup(snapshotArg(args));
const targets = all ? Object.keys(backup) : names;
if (!targets.length) {
  console.error('Nothing to restore. Pass theme names or --all.');
  process.exit(1);
}
for (const n of targets) {
  if (!backup[n]) throw new Error(`${n} is not in the snapshot`);
}

console.log('restoring:', targets.join(', '));
if (!yes) {
  console.log('dry run — re-run with --yes to actually PUT');
  process.exit(0);
}

const payload = Object.fromEntries(targets.map((n) => [n, backup[n]]));
const res = await putThemes(payload);
console.log('PUT ->', res.status, res.text.slice(0, 200));
if (!res.ok) process.exit(1);

const { json } = await getThemes();
let bad = 0;
for (const n of targets) {
  const diff = diffThemes(json[n], backup[n]);
  console.log(`${n}: ${diff.length ? 'MISMATCH' : 'restored'}`);
  bad += diff.length;
}
process.exit(bad ? 1 : 0);
