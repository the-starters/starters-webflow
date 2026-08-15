// Step 2: export the two live Chat Themes from a snapshot into the repo folder
// tree. Reads the snapshot rather than the API so the committed export and the
// disaster-recovery snapshot are provably the same bytes.
//
//   node --env-file=.env ../starters-webflow/talkjs-themes/tools/export-themes.mjs
//   … --snapshot <path>      export from a specific snapshot instead of the newest
//   … <target-dir>           write somewhere other than the repo folder
import { mustLoadBackup, writeThemeToDisk, snapshotArg, REPO_THEMES_DIR } from './lib.mjs';

const args = process.argv.slice(2);
const positional = args.filter((a, i) => !a.startsWith('--') && args[i - 1] !== '--snapshot');
const TARGET = positional[0] || REPO_THEMES_DIR;
const THEMES = ['the-starters-3-0', 'the-starters-3-0-profile'];

const all = mustLoadBackup(snapshotArg(args));
for (const name of THEMES) {
  if (!all[name]) throw new Error(`Theme ${name} not present in the snapshot`);
  const files = writeThemeToDisk(TARGET, name, all[name]);
  console.log(`${name}: base=${all[name].base} files=${files.length}`);
  for (const f of files) console.log(`   ${f}`);
}
console.log(`\nwritten to ${TARGET}`);
