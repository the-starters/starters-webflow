// Rebuild the Algolia `LearnContent` index from the Webflow Learn collections.
// Node tooling: never served to a browser. Reads ALGOLIA_WRITE_KEY and
// WEBFLOW_API_TOKEN from the environment and never prints or stores either.
//
//   node --env-file=../staging-qa/.env scripts/learn-reindex.mjs --dry-run
//   node --env-file=../staging-qa/.env scripts/learn-reindex.mjs --webflow-export export.json
//   node --env-file=../staging-qa/.env scripts/learn-reindex.mjs --write
//
// `--dry-run` is the default and never writes to Algolia. `--write` replaces
// the whole index atomically (copy settings to a temp index, fill it, move it
// over `LearnContent`). `--webflow-export <path>` reads the CMS from a JSON
// export instead of api.webflow.com, so no Webflow token is needed. Every run
// dumps the proposed records into the gitignored `scripts/.learn-reindex-out/`.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve as resolvePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  COLLECTIONS,
  createExportResolver,
  diffRecords,
  isLiveItem,
  normalizeExport,
  optionMapsFromSchema,
  stripHighlight,
} from './learn-reindex-lib.mjs';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(SCRIPT_DIR, '.learn-reindex-out');

const WEBFLOW_BASE = 'https://api.webflow.com/v2';
const WEBFLOW_MAX_RETRIES = 5;
const WEBFLOW_RETRY_MS = 5000;
const PAGE_SIZE = 100;

const ALGOLIA_APP_ID = 'PKVW6M9OPZ';
const ALGOLIA_BASE = `https://${ALGOLIA_APP_ID}.algolia.net/1`;
const INDEX = 'LearnContent';
const BATCH_SIZE = 500;
const TASK_POLL_MS = 500;
const TASK_TIMEOUT_MS = 60000;
// Safety rail: a near-empty proposal means a broken fetch, not a real change.
const MIN_RECORDS_TO_WRITE = 10;

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

function parseArgs(argv) {
  const args = { write: false, exportPath: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--write') args.write = true;
    else if (arg === '--dry-run') args.write = false;
    else if (arg === '--webflow-export') {
      // Guard against swallowing the next flag as the path.
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('--webflow-export needs a path');
      }
      args.exportPath = value;
    } else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} (run with: node --env-file=../staging-qa/.env …)`);
  return value;
}

// --- Webflow API ------------------------------------------------------------

async function webflow(path, { allow404 = false } = {}) {
  const url = `${WEBFLOW_BASE}${path}`;
  for (let attempt = 0; ; attempt += 1) {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${requireEnv('WEBFLOW_API_TOKEN')}`, accept: 'application/json' },
    });
    if (res.status === 429) {
      if (attempt >= WEBFLOW_MAX_RETRIES) throw new Error(`Webflow HTTP 429 after ${attempt} retries: ${url}`);
      const retryAfter = Number(res.headers.get('retry-after'));
      await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : WEBFLOW_RETRY_MS);
      continue;
    }
    if (res.status === 404 && allow404) return null;
    if (!res.ok) throw new Error(`Webflow HTTP ${res.status}: ${url}`);
    return res.json();
  }
}

async function fetchLiveItems(collectionId) {
  const items = [];
  let offset = 0;
  // An empty page is the only end condition; a missing pagination total must
  // not be read as "done after the first page".
  for (;;) {
    const page = await webflow(`/collections/${collectionId}/items/live?limit=${PAGE_SIZE}&offset=${offset}`);
    const batch = page.items ?? [];
    if (batch.length === 0) break;
    items.push(...batch);
    offset += PAGE_SIZE;
  }
  return items;
}

function apiSource(dangling) {
  const cache = new Map();
  const resolve = async (collectionId, itemId) => {
    const key = `${collectionId}/${itemId}`;
    if (!cache.has(key)) {
      cache.set(key, await webflow(`/collections/${collectionId}/items/${itemId}/live`, { allow404: true }));
    }
    const item = cache.get(key);
    if (!isLiveItem(item)) {
      dangling.set(key, (dangling.get(key) ?? 0) + 1);
      return null;
    }
    return item;
  };

  return {
    label: 'Webflow API (live items)',
    resolve,
    async collections() {
      const out = [];
      for (const config of COLLECTIONS) {
        const schema = await webflow(`/collections/${config.id}`);
        // A renamed collection would silently rewrite every /learn/ URL.
        if (schema.slug !== config.expectedSlug) {
          throw new Error(
            `Collection ${config.name} (${config.id}) slug is "${schema.slug}", expected "${config.expectedSlug}". Aborting.`
          );
        }
        const items = (await fetchLiveItems(config.id)).filter(isLiveItem);
        out.push({ config, schema, items });
      }
      return out;
    },
  };
}

// --- Webflow export file ----------------------------------------------------

function exportSource(path, dangling) {
  const data = JSON.parse(readFileSync(path, 'utf8'));
  const entries = normalizeExport(data);
  const resolve = createExportResolver(data.refs, (collectionId, itemId) => {
    const key = `${collectionId}/${itemId}`;
    dangling.set(key, (dangling.get(key) ?? 0) + 1);
  });

  return {
    label: `Webflow export ${path} (exportedAt ${data.exportedAt ?? 'unknown'})`,
    resolve,
    async collections() {
      const byId = new Map(entries.map((entry) => [entry.schema.id, entry]));
      return COLLECTIONS.map((config) => {
        const entry = byId.get(config.id);
        if (!entry) throw new Error(`Export is missing collection ${config.name} (${config.id})`);
        if (entry.schema.slug !== config.expectedSlug) {
          throw new Error(
            `Collection ${config.name} (${config.id}) slug is "${entry.schema.slug}", expected "${config.expectedSlug}". Aborting.`
          );
        }
        return { config, schema: entry.schema, items: entry.items.filter(isLiveItem) };
      });
    },
  };
}

// --- Algolia ----------------------------------------------------------------

async function algolia(method, path, body) {
  const res = await fetch(`${ALGOLIA_BASE}${path}`, {
    method,
    headers: {
      'X-Algolia-Application-Id': ALGOLIA_APP_ID,
      'X-Algolia-API-Key': requireEnv('ALGOLIA_WRITE_KEY'),
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Algolia HTTP ${res.status}: ${method} ${path}`);
  return res.json();
}

async function browseIndex() {
  const hits = [];
  let cursor;
  do {
    const page = await algolia('POST', `/indexes/${INDEX}/browse`, cursor ? { hitsPerPage: 1000, cursor } : { hitsPerPage: 1000 });
    for (const hit of page.hits ?? []) hits.push(stripHighlight(hit));
    cursor = page.cursor;
  } while (cursor);
  return hits;
}

async function waitForTask(index, taskID) {
  const deadline = Date.now() + TASK_TIMEOUT_MS;
  for (;;) {
    const { status } = await algolia('GET', `/indexes/${index}/task/${taskID}`);
    if (status === 'published') return;
    if (Date.now() > deadline) throw new Error(`Algolia task ${taskID} on ${index} still ${status} after ${TASK_TIMEOUT_MS}ms`);
    await sleep(TASK_POLL_MS);
  }
}

async function replaceAllObjects(records) {
  const tmp = `${INDEX}_tmp_${Math.floor(Date.now() / 1000)}`;
  const copy = await algolia('POST', `/indexes/${INDEX}/operation`, {
    operation: 'copy',
    destination: tmp,
    scope: ['settings', 'synonyms', 'rules'],
  });
  try {
    await waitForTask(INDEX, copy.taskID);
    for (let i = 0; i < records.length; i += BATCH_SIZE) {
      const chunk = records.slice(i, i + BATCH_SIZE);
      const batch = await algolia('POST', `/indexes/${tmp}/batch`, {
        requests: chunk.map((body) => ({ action: 'addObject', body })),
      });
      await waitForTask(tmp, batch.taskID);
      console.log(`  uploaded ${Math.min(i + BATCH_SIZE, records.length)}/${records.length}`);
    }
    const move = await algolia('POST', `/indexes/${tmp}/operation`, { operation: 'move', destination: INDEX });
    await waitForTask(tmp, move.taskID);
  } catch (error) {
    // The copy may still be queued; deleting before it lands leaks the index.
    await waitForTask(INDEX, copy.taskID).catch(() => {});
    await algolia('DELETE', `/indexes/${tmp}`).catch(() => {});
    throw error;
  }
  return tmp;
}

// --- Reporting --------------------------------------------------------------

function show(value) {
  return typeof value === 'object' && value !== null ? JSON.stringify(value) : String(value);
}

function printDiff(diff, dangling, warnings) {
  console.log(`\nadded (${diff.added.length}):`);
  for (const r of diff.added) console.log(`  ${r.objectID}  ${r.title}  ${r.url}`);

  console.log(`\nremoved (${diff.removed.length}):`);
  for (const r of diff.removed) console.log(`  ${r.objectID}  ${r.title}  ${r.url}`);

  console.log(`\nchanged (${diff.changed.length}):`);
  for (const r of diff.changed) {
    console.log(`  ${r.objectID}  ${r.title}`);
    for (const field of r.fields) {
      if ('from' in field) console.log(`    ${field.name}: ${show(field.from)} -> ${show(field.to)}`);
      else console.log(`    ${field.name}`);
    }
  }

  console.log(`\nunchanged: ${diff.unchangedCount}`);

  console.log(`\ndangling references (${dangling.size}):`);
  for (const [key, count] of dangling) console.log(`  ${key}${count > 1 ? ` (x${count})` : ''}`);

  console.log(`\nwarnings (${warnings.length}):`);
  for (const line of warnings) console.log(`  ${line}`);
}

// --- Main -------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dangling = new Map();
  const warnings = [];
  const source = args.exportPath ? exportSource(resolvePath(args.exportPath), dangling) : apiSource(dangling);

  console.log(`mode: ${args.write ? 'WRITE' : 'dry run'}`);
  console.log(`source: ${source.label}`);

  const proposed = [];
  for (const { config, schema, items } of await source.collections()) {
    const optionMaps = optionMapsFromSchema(schema);
    for (const item of items) {
      proposed.push(
        await config.map({ item, collectionSlug: schema.slug, optionMaps, resolve: source.resolve, warnings })
      );
    }
    console.log(`  ${config.name}: ${items.length} item(s) from /learn/${schema.slug}/`);
  }

  const current = await browseIndex();
  console.log(`\ncurrent records: ${current.length}`);
  console.log(`proposed records: ${proposed.length}`);

  const diff = diffRecords(current, proposed);
  printDiff(diff, dangling, warnings);

  const outPath = join(OUT_DIR, `proposed-${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(proposed, null, 2)}\n`);
  console.log(`\nproposed records written to ${outPath}`);

  if (!args.write) {
    console.log('\ndry run: nothing was written to Algolia.');
    return;
  }

  if (proposed.length < MIN_RECORDS_TO_WRITE) {
    throw new Error(
      `Refusing --write: only ${proposed.length} proposed record(s), below the ${MIN_RECORDS_TO_WRITE} safety floor. Check the Webflow fetch first.`
    );
  }

  console.log(`\nwriting ${proposed.length} record(s) to ${INDEX} …`);
  const tmp = await replaceAllObjects(proposed);
  console.log(`done: ${tmp} moved over ${INDEX} (${proposed.length} record(s)).`);
}

main().catch((error) => {
  console.error(error.message);
  if (error.cause?.message) console.error(`  cause: ${error.cause.message}`);
  process.exitCode = 1;
});
