// Step 1: snapshot every theme on the account to the snapshot directory
// (outside git — the export is what git holds; this is the raw API response).
// Never prints the key.
//
//   node --env-file=.env ../starters-webflow/talkjs-themes/tools/get-themes.mjs
//   node --env-file=.env ../starters-webflow/talkjs-themes/tools/get-themes.mjs <outfile>
//
// With no argument it writes full-themes-backup-<timestamp>.json and the rest
// of the tooling picks it up automatically as the newest snapshot. Naming it
// yourself is supported but no longer required — the old flow, where you chose
// a filename the tools did not know about, is what made stale snapshots easy.
import { writeFileSync } from 'node:fs';
import { getThemes, writeSnapshot, SNAPSHOT_DIR } from './lib.mjs';

const out = process.argv.find((a, i) => i >= 2 && !a.startsWith('--'));

const { text, json } = await getThemes();
let path;
if (out) {
  writeFileSync(out, text);
  path = out;
} else {
  path = writeSnapshot(json);
}

console.log('theme names:', Object.keys(json).join(', '));
for (const [name, body] of Object.entries(json)) {
  const files = body.files ? Object.keys(body.files) : [];
  console.log(`  ${name}: keys=[${Object.keys(body).join(',')}] files=${files.length}`);
}
console.log(`\nsnapshot written: ${path}`);
if (!out) console.log(`(newest snapshot in ${SNAPSHOT_DIR} — restore/export use it automatically)`);
