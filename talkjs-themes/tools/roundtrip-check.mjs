// Step 3: prove the repo folder format is lossless.
// Reconstructs each theme's PUT payload from the files on disk and asserts
// byte-identity with the API's own response for the same theme.
//
//   node --env-file=.env ../starters-webflow/talkjs-themes/tools/roundtrip-check.mjs --live
//   node --env-file=.env ../starters-webflow/talkjs-themes/tools/roundtrip-check.mjs
//
// Without --live it compares against the newest snapshot instead of the API,
// which needs no network but only proves the export, not the account.
import { readThemeFromDisk, mustLoadBackup, diffThemes, getThemes, snapshotArg, REPO_THEMES_DIR } from './lib.mjs';

const args = process.argv.slice(2);
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--snapshot');
const TARGET = positional[0] || REPO_THEMES_DIR;
const THEMES = ['the-starters-3-0', 'the-starters-3-0-profile'];
const LIVE = args.includes('--live');

const reference = LIVE ? (await getThemes()).json : mustLoadBackup(snapshotArg(args));
console.log(`comparing ${TARGET} against ${LIVE ? 'a fresh live GET' : 'the snapshot'}\n`);

let failures = 0;
for (const name of THEMES) {
  const fromDisk = readThemeFromDisk(TARGET, name);
  const fromApi = reference[name];
  for (const s of fromDisk.skipped) console.log(`   note: skipped ${name}/${s.entry} (${s.why})`);
  const diff = diffThemes(fromDisk, fromApi);
  const canon = (o) =>
    JSON.stringify(o, (k, v) =>
      v && typeof v === 'object' && !Array.isArray(v)
        ? Object.fromEntries(Object.entries(v).sort(([x], [y]) => (x < y ? -1 : 1)))
        : v
    );
  const identical = canon(fromDisk) === canon(fromApi);
  console.log(`${name}: files=${Object.keys(fromDisk.files).length} ` +
    `canonical-JSON identical=${identical} diffs=${diff.length}`);
  if (diff.length) {
    failures++;
    for (const d of diff) console.log(`   DIFF ${d}`);
  }
  if (!identical) failures++;
}

if (failures) {
  console.log('\nROUND-TRIP FAILED');
  process.exit(1);
}
console.log('\nROUND-TRIP OK — repo tree reconstructs the API payload byte-for-byte');
