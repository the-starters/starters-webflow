// End-to-end self-test for promote-to-real.mjs, against a THROWAWAY theme.
//
//   cd staging-qa
//   unset PLAYWRIGHT_BROWSERS_PATH
//   node --env-file=.env ../starters-webflow/talkjs-themes/tools/selftest.mjs
//
// It creates `zz-selftest-promote` on the account with a deliberate divergence
// from a folder copy (one changed file, one file that exists only live), drives
// the real CLI through every refusal and the success path, then deletes it and
// proves the account is exactly as it was found.
//
// Why this is committed rather than done by hand: the promotion tool cannot be
// rehearsed against the real themes, so the only evidence it works is a run
// against a throwaway name — and evidence that cannot be re-run from a fresh
// clone is not evidence, it is a claim about someone's laptop.
//
// Safety: the target name is hardcoded and asserted to be neither of the real
// themes; the real theme names are read before and after and must be
// byte-identical; snapshots are redirected to a temp directory so the real
// rollback namespace is untouched.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { getThemes, putThemes, diffThemes, readThemeFromDisk, listSnapshots, REPO_THEMES_DIR, SNAPSHOT_DIR } from './lib.mjs';

const THEME = 'zz-selftest-promote';
const REAL_THEMES = ['the-starters-3-0', 'the-starters-3-0-profile'];
const SOURCE_THEME = 'the-starters-3-0-profile'; // copied to make the throwaway
const PROMOTE = fileURLToPath(new URL('./promote-to-real.mjs', import.meta.url));

if (REAL_THEMES.includes(THEME) || !THEME.startsWith('zz-selftest')) {
  throw new Error(`refusing to self-test against ${THEME}`);
}

let failures = 0;
const results = [];
function check(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
}

const tmp = mkdtempSync(join(tmpdir(), 'talkjs-selftest-'));
const themesDir = join(tmp, 'themes');
const snapDir = join(tmp, 'snapshots');
const evidenceDir = join(tmp, 'evidence');
cpSync(join(REPO_THEMES_DIR, SOURCE_THEME), join(themesDir, THEME), { recursive: true });
rmSync(join(themesDir, THEME, '.DS_Store'), { force: true });

// Every child run is redirected away from the real snapshot namespace.
const env = { ...process.env, TALKJS_SNAPSHOT_DIR: snapDir };
const run = (...args) => {
  const r = spawnSync(process.execPath, [PROMOTE, '--themes', THEME, '--dir', themesDir, ...args], {
    env,
    encoding: 'utf8',
  });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
};

console.log(`self-test: ${THEME}`);
console.log(`  workspace: ${tmp}`);
console.log(`  real snapshot dir (must stay untouched): ${SNAPSHOT_DIR}\n`);

const snapshotsBefore = listSnapshots().map((s) => s.path);
const accountBefore = (await getThemes()).json;
const realBefore = Object.fromEntries(REAL_THEMES.map((n) => [n, accountBefore[n]]));
if (accountBefore[THEME]) throw new Error(`${THEME} already exists — clean it up before running this`);

try {
  // --- refusals that must happen before the theme even exists ---------------
  console.log('argument and pre-flight refusals:');
  let r = run();
  check('a theme absent from the account is refused without --allow-new', r.code === 1 && /--allow-new/.test(r.out));

  r = run('--allow-new', '--confirm', '--dry-run');
  check(
    'B3: --confirm --dry-run refuses instead of silently writing',
    r.code === 1 && /Refusing to guess/.test(r.out),
    `exit ${r.code}`
  );

  r = run('--allow-new', '--confirm', '--drynrun');
  check('an unrecognized flag is rejected, not ignored', r.code === 1 && /unrecognized argument/.test(r.out));

  r = run('--allow-new', '--themes');
  check('a value flag with no value is rejected', r.code === 1 && /needs a value/.test(r.out));

  // --- seed the throwaway with a real divergence ----------------------------
  const folder = readThemeFromDisk(themesDir, THEME);
  const seeded = { ...folder, files: { ...folder.files } };
  seeded.files['Avatar.template'] = '<!-- SEEDED DIVERGENCE -->\n' + seeded.files['Avatar.template'];
  seeded.files['OnlyLive.template'] = '<div>exists live, absent from the folder</div>\n';
  const seedRes = await putThemes({ [THEME]: seeded });
  if (!seedRes.ok) throw new Error(`could not seed the throwaway theme: ${seedRes.status} ${seedRes.text}`);
  console.log(`\nseeded ${THEME}: 1 changed file, 1 live-only file\n`);

  // --- the deletion gate ----------------------------------------------------
  console.log('deletion gate and dry run:');
  r = run('--confirm');
  check(
    'B4: a live-file deletion is refused by default and named',
    r.code === 1 && /would DELETE 1 file/.test(r.out) && /OnlyLive\.template/.test(r.out),
    `exit ${r.code}`
  );

  r = run();
  const dryRunSnapshots = existsSync(join(snapDir, 'dry-runs')) ? readdirSync(join(snapDir, 'dry-runs')) : [];
  check(
    'dry run previews the deletion instead of refusing, and names the flag a real run needs',
    r.code === 0 && /DELETE\s+OnlyLive\.template/.test(r.out) && /REFUSES unless you pass --allow-deletions/.test(r.out),
    `exit ${r.code}`
  );
  check('Q5: the dry run wrote a rehearsal snapshot', dryRunSnapshots.length === 1, dryRunSnapshots.join(','));
  check(
    'Q5: the rehearsal snapshot is invisible to snapshot resolution',
    listSnapshots(snapDir).length === 0,
    `resolver sees ${listSnapshots(snapDir).length} in ${snapDir}`
  );
  check('the live theme was NOT changed by the dry run', !diffThemes((await getThemes()).json[THEME], seeded).length);

  // --- the real thing -------------------------------------------------------
  console.log('\npromotion:');
  r = run('--confirm', '--allow-deletions', '--evidence', evidenceDir);
  check('promotion with --allow-deletions succeeds', r.code === 0, `exit ${r.code}`);
  check('the pre-PUT record was written before the PUT', existsSync(join(evidenceDir, 'pre-put-plan.json')));
  check('the report was written', existsSync(join(evidenceDir, 'promote-report.json')));

  const live = (await getThemes()).json;
  check('live now matches the folder byte-for-byte', !diffThemes(live[THEME], readThemeFromDisk(themesDir, THEME)).length);
  check('the live-only file was deleted by the whole-theme PUT', !('OnlyLive.template' in live[THEME].files));

  if (existsSync(join(evidenceDir, 'promote-report.json'))) {
    const report = JSON.parse(readFileSync(join(evidenceDir, 'promote-report.json'), 'utf8'));
    check('the report names a snapshot that exists on disk', existsSync(report.snapshotPath), report.snapshotPath);
    check(
      'B1/W5: the restore command is runnable as printed, and scoped to the targets',
      /^node --env-file=\.env \//.test(report.restoreCommand) &&
        report.restoreCommand.includes(`tools/restore.mjs ${THEME} `) &&
        /--snapshot \//.test(report.restoreCommand) &&
        /--confirm$/.test(report.restoreCommand) &&
        !/--all/.test(report.restoreCommand),
      report.restoreCommand
    );
    check('every other theme verified unchanged', Object.values(report.everyOtherThemeUnchanged).every((v) => v === 'byte-identical to the pre-PUT snapshot'));
  }

  r = run('--confirm', '--allow-deletions');
  check('a re-run is a no-op and sends no PUT', r.code === 0 && /Nothing to do/.test(r.out));
} finally {
  // --- clean up -------------------------------------------------------------
  const del = await putThemes({ [THEME]: null });
  const accountAfter = (await getThemes()).json;
  console.log('\ncleanup and account integrity:');
  check('the throwaway theme was deleted', del.ok && !(THEME in accountAfter));
  check(
    'the account holds exactly the themes it started with',
    JSON.stringify(Object.keys(accountAfter).sort()) === JSON.stringify(Object.keys(accountBefore).sort())
  );
  for (const n of REAL_THEMES) {
    check(`${n} is byte-identical to before the self-test`, !diffThemes(accountAfter[n], realBefore[n]).length);
  }
  check(
    'the real snapshot directory gained nothing',
    JSON.stringify(listSnapshots().map((s) => s.path)) === JSON.stringify(snapshotsBefore)
  );
  rmSync(tmp, { recursive: true, force: true });
}

console.log(`\n${failures ? `SELF-TEST FAILED — ${failures} of ${results.length} checks` : `SELF-TEST PASSED — ${results.length} checks`}`);
process.exit(failures ? 1 : 0);
