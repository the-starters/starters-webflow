// Step 4: push the repo folders to the CLONE theme names (…-qa) and prove
// nothing else on the account moved. Every change goes here first — the API
// bypasses the dashboard's Test→Publish safeguard, so the clones are the only
// place a theme edit can be looked at before members see it (ADR 0004).
//
//   node --env-file=.env ../starters-webflow/talkjs-themes/tools/put-clones.mjs
//   node --env-file=.env ../starters-webflow/talkjs-themes/tools/put-clones.mjs --yes
//   … --dir <path>   read the folders from somewhere else (an edited working copy)
//
// It takes its OWN full snapshot immediately before the PUT and uses that as
// the "nothing else moved" reference. It deliberately does not depend on a
// stored snapshot file: this step must work on a machine that has none.
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { lintThemes } from './lint-templates.mjs';
import {
  readThemeFromDisk,
  getThemes,
  putThemes,
  diffThemes,
  themesGitHead,
  REPO_THEMES_DIR,
  SNAPSHOT_DIR,
} from './lib.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(name);
  return i !== -1 && args[i + 1] ? args[i + 1] : fallback;
};
// Both confirm words are accepted across all three tools. Getting "re-run with
// --yes" back from a tool you just told --confirm is a poor use of an incident.
const yes = args.includes('--yes') || args.includes('--confirm');
const dir = opt('--dir', REPO_THEMES_DIR);
const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const EVIDENCE = opt('--evidence', join(SNAPSHOT_DIR, 'clone-evidence', stamp));

const SOURCES = opt('--themes', 'the-starters-3-0,the-starters-3-0-profile')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);
const CLONES = Object.fromEntries(SOURCES.map((s) => [`${s}-qa`, s]));

const lintProblems = lintThemes(dir, SOURCES);
if (lintProblems.length) {
  console.error(`ABORT — template lint failed:\n${lintProblems.map((p) => `     ${p}`).join('\n')}`);
  process.exit(1);
}
console.log('template lint: clean');

const payload = {};
for (const [clone, source] of Object.entries(CLONES)) {
  if (!existsSync(join(dir, source, 'theme.json'))) {
    console.error(`ABORT — no theme folder at ${join(dir, source)}`);
    process.exit(1);
  }
  // Complete file map — a partial PUT would drop every file it omitted.
  payload[clone] = readThemeFromDisk(dir, source);
  console.log(`  payload ${clone}: ${Object.keys(payload[clone].files).length} files from ${source}/`);
  for (const s of payload[clone].skipped) console.log(`     skipped ${s.entry} (${s.why})`);
}

const before = (await getThemes()).json;
console.log(`pre-PUT: ${Object.keys(before).length} themes on the account`);
for (const [clone, source] of Object.entries(CLONES)) {
  const d = before[clone] ? diffThemes(before[clone], before[source]) : null;
  console.log(`  ${clone}: ${!before[clone] ? 'does not exist yet' : d.length ? 'differs from ' + source : 'identical to ' + source}`);
}

if (!yes) {
  console.log('dry run — re-run with --yes');
  process.exit(0);
}

mkdirSync(EVIDENCE, { recursive: true });
writeFileSync(join(EVIDENCE, 'themes-pre-put.json'), JSON.stringify(before, null, 2) + '\n');

const res = await putThemes(payload);
console.log('PUT ->', res.status, res.text.slice(0, 300));
if (!res.ok) process.exit(1);

const after = (await getThemes()).json;
writeFileSync(join(EVIDENCE, 'themes-post-put.json'), JSON.stringify(after, null, 2) + '\n');

const report = {
  ranAt: new Date().toISOString(),
  sourceDir: dir,
  gitHead: themesGitHead(dir),
  putKeys: Object.keys(payload),
  clonesMatchFolder: {},
  everyOtherThemeUnchanged: {},
  verdict: '',
};
let fatal = 0;

for (const clone of Object.keys(CLONES)) {
  if (!after[clone]) {
    report.clonesMatchFolder[clone] = 'MISSING';
    fatal++;
    continue;
  }
  const d = diffThemes(after[clone], payload[clone]);
  report.clonesMatchFolder[clone] = d.length ? d : `byte-identical to ${CLONES[clone]}/`;
  if (d.length) fatal++;
}
for (const n of Object.keys(before)) {
  if (n in CLONES) continue;
  if (!after[n]) {
    report.everyOtherThemeUnchanged[n] = 'DELETED';
    fatal++;
    continue;
  }
  const d = diffThemes(after[n], before[n]);
  report.everyOtherThemeUnchanged[n] = d.length ? d : 'byte-identical to the pre-PUT snapshot';
  if (d.length) fatal++;
}
for (const n of Object.keys(after)) {
  if (!(n in before) && !(n in CLONES)) {
    report.everyOtherThemeUnchanged[n] = 'UNEXPECTED NEW THEME';
    fatal++;
  }
}

report.verdict = fatal
  ? 'FAIL — the PUT did something other than write the clones'
  : 'PASS — clones carry the folder content; every other theme byte-identical';
console.log(JSON.stringify(report, null, 2));
writeFileSync(join(EVIDENCE, 'put-report.json'), JSON.stringify(report, null, 2) + '\n');
console.log(`\nevidence: ${EVIDENCE}`);
process.exit(fatal ? 1 : 0);
