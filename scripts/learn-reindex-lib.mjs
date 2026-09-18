// Pure mapping layer for the LearnContent reindex. No network, no secrets, no
// file I/O — everything here is unit-testable with fake data.
//
// Webflow CMS item -> Algolia record. Reference fields (authors, categories,
// speakers, sessions) are resolved through an injected
// `resolve(collectionId, itemId) -> item | null` so tests can fake them.
//
// Mappers take a ctx: { item, collectionSlug, optionMaps, resolve, warnings }.
// `warnings` is optional; when present it collects non-fatal data problems.
import { isDeepStrictEqual } from 'node:util';

// Referenced collections. Ids are the live Webflow collection ids.
export const REF_COLLECTIONS = {
  freelancers: '69f241ec147b71addb6f1531',
  categories: '69f2329d4f5bacf6765c1ca1',
  sessions: '69e08554183023227aa46c1e',
};

const LEARN_URL_PREFIX = '/learn';

// The existing index uses the singular for the Interviews resource type.
const INTERVIEW_LVL1_ALIASES = { Interviews: 'Interview' };

/** ISO 8601 -> integer unix seconds. Null/unparseable -> null. */
export function toUnixSeconds(iso) {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? Math.floor(ms / 1000) : null;
}

/** `collectionSlug` always comes from the API schema, never a hard-coded string. */
export function buildUrl(collectionSlug, itemSlug) {
  return `${LEARN_URL_PREFIX}/${collectionSlug}/${itemSlug}`;
}

/** Collection schema response -> { fieldSlug: { optionId: optionName } }. */
export function optionMapsFromSchema(schema) {
  const maps = {};
  for (const field of schema?.fields ?? []) {
    const options = field?.validations?.options;
    if (!Array.isArray(options) || !field.slug) continue;
    const byId = {};
    for (const option of options) if (option?.id) byId[option.id] = option.name ?? null;
    maps[field.slug] = byId;
  }
  return maps;
}

function warn(ctx, message) {
  if (Array.isArray(ctx?.warnings)) ctx.warnings.push(message);
}

// An id the schema does not know about means the schema moved under us.
function optionName(ctx, fieldSlug) {
  const optionId = ctx.item.fieldData?.[fieldSlug] ?? null;
  if (!optionId) return null;
  const name = ctx.optionMaps?.[fieldSlug]?.[optionId] ?? null;
  if (name === null) {
    warn(ctx, `Item ${ctx.item.id} (${ctx.collectionSlug}): option id ${optionId} not in schema field ${fieldSlug}`);
  }
  return name;
}

// Collections that own a date field should always carry one; createdOn is a
// fallback, not an equivalent, so an empty field is worth surfacing.
function requiredDate(ctx, fieldSlug) {
  const seconds = toUnixSeconds(ctx.item.fieldData?.[fieldSlug] ?? null);
  if (seconds === null) {
    warn(ctx, `Item ${ctx.item.id} (${ctx.collectionSlug}): no ${fieldSlug} date, falling back to createdOn`);
  }
  return seconds;
}

function imageUrl(value) {
  return value?.url ?? null;
}

function idList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

// A reference that resolves but carries no slug is unusable here; it is still
// dropped, but never in silence.
function warnSlugless(ctx, collectionId, itemId) {
  warn(ctx, `Item ${ctx.item.id} (${ctx.collectionSlug}): reference ${collectionId}/${itemId} has no slug, dropped`);
}

/** Resolve reference ids to their item slugs; unresolved refs drop out. */
async function slugsFor(ctx, collectionId, value) {
  const slugs = [];
  for (const id of idList(value)) {
    const item = await ctx.resolve(collectionId, id);
    if (!item) continue;
    const slug = item.fieldData?.slug;
    if (slug) slugs.push(slug);
    else warnSlugless(ctx, collectionId, id);
  }
  return slugs;
}

/** Freelancer reference -> { author slug, memberstack id }; both null when missing. */
async function authorFrom(ctx, id) {
  if (!id) return { author: null, memberstack_id: null };
  const item = await ctx.resolve(REF_COLLECTIONS.freelancers, id);
  if (!item) return { author: null, memberstack_id: null };
  const slug = item.fieldData?.slug ?? null;
  if (!slug) warnSlugless(ctx, REF_COLLECTIONS.freelancers, id);
  return {
    author: slug,
    memberstack_id: item.fieldData?.['memberstack-id'] ?? null,
  };
}

function contentType(lvl0, lvl1) {
  return lvl1 ? { lvl0, lvl1 } : { lvl0 };
}

function core(ctx, { lvl0, lvl1, description, thumbnail, date, author, categories }) {
  const { item, collectionSlug } = ctx;
  const fieldData = item.fieldData ?? {};
  const slug = fieldData.slug;
  if (!slug) {
    throw new Error(`Item ${item.id} in /learn/${collectionSlug}/ has no slug, so it has no page URL`);
  }
  // createdOn is the last fallback; with nothing left the record sorts wrong.
  const resolvedDate = date ?? toUnixSeconds(item.createdOn);
  if (resolvedDate === null) {
    warn(ctx, `Item ${item.id} (${collectionSlug}): no date and no createdOn, indexed with date null`);
  }
  return {
    objectID: item.id,
    title: fieldData.name ?? null,
    slug,
    url: buildUrl(collectionSlug, slug),
    content_type: contentType(lvl0, lvl1),
    description: description ?? null,
    thumbnail_url: thumbnail ?? null,
    date: resolvedDate,
    published_on: toUnixSeconds(item.lastPublished),
    author,
    categories,
  };
}

async function mapInterview(ctx) {
  const { item } = ctx;
  const f = item.fieldData ?? {};
  const { author, memberstack_id } = await authorFrom(ctx, f['autor-3']);
  const resourceType = optionName(ctx, 'category');
  const lvl1 = resourceType
    ? `Interview & News > ${INTERVIEW_LVL1_ALIASES[resourceType] ?? resourceType}`
    : null;
  return {
    ...core(ctx, {
      lvl0: 'Interview & News',
      lvl1,
      description: f['description-2'] ?? null,
      thumbnail: imageUrl(f.image),
      date: requiredDate(ctx, 'publish-date'),
      author,
      categories: await slugsFor(ctx, REF_COLLECTIONS.categories, f['category-interviews']),
    }),
    budget: optionName(ctx, 'budget'),
    featured: f.featured === true,
    memberstack_id,
  };
}

async function mapPlaybook(ctx) {
  const { item } = ctx;
  const f = item.fieldData ?? {};
  const { author, memberstack_id } = await authorFrom(ctx, f['author-2']);
  const type = optionName(ctx, 'type');
  return {
    ...core(ctx, {
      lvl0: 'Playbook',
      lvl1: type ? `Playbook > ${type}` : null,
      description: f.description ?? null,
      thumbnail: imageUrl(f['list-cover---image']),
      date: null, // no date field on this collection; core falls back to createdOn
      author,
      categories: await slugsFor(ctx, REF_COLLECTIONS.categories, f['category-3']),
    }),
    version: f.version ?? null,
    associated_sessions: await slugsFor(ctx, REF_COLLECTIONS.sessions, f['associated-session']),
    gated: false, // no source field in Webflow; every existing record carries false
    memberstack_id,
  };
}

async function mapSession(ctx) {
  const { item } = ctx;
  const f = item.fieldData ?? {};
  const { author, memberstack_id } = await authorFrom(ctx, f['autor-starter']);
  return {
    ...core(ctx, {
      lvl0: 'Session',
      lvl1: null,
      description: f.description ?? null,
      thumbnail: imageUrl(f['image-prev-2']),
      date: null, // no date field on this collection
      author,
      categories: await slugsFor(ctx, REF_COLLECTIONS.categories, f['sessions-category-2']),
    }),
    time_watching: f['time-watching'] ?? null,
    video_id: f['id-video-for-waching'] ?? null,
    memberstack_id,
  };
}

// Podcasts are deliberately absent: the Lists collection has no page.
// Events and Webinars are deliberately absent too: they are no longer indexed.
export const COLLECTIONS = [
  {
    name: 'Interview & News',
    id: '69dca9df095d2fbcf34e255b',
    expectedSlug: 'interviews-analysis',
    map: mapInterview,
  },
  {
    name: 'Playbooks & Frameworks',
    id: '69e1e416f6476e12f572b39b',
    expectedSlug: 'playbooks-frameworks',
    map: mapPlaybook,
  },
  {
    name: 'Sessions',
    id: REF_COLLECTIONS.sessions,
    expectedSlug: 'sessions',
    map: mapSession,
  },
];

export function collectionById(id) {
  return COLLECTIONS.find((c) => c.id === id) ?? null;
}

/**
 * The single liveness test, used for both input sources and both resolvers.
 * The API's /live endpoint only returns published items, so lastPublished is
 * always set there; an export is a plain dump, so the same check earns its keep.
 */
export function isLiveItem(item) {
  return Boolean(item?.id) && item.isArchived !== true && typeof item.lastPublished === 'string' && item.lastPublished !== '';
}

// Only these fields are worth printing old -> new; the rest are too long.
const VERBOSE_DIFF_FIELDS = new Set(['url', 'slug', 'content_type']);

function identity(record) {
  return { objectID: record.objectID, title: record.title ?? null, url: record.url ?? null };
}

/**
 * Compare the proposed record set against what the index holds today.
 * Returns { added, removed, changed, unchangedCount }; `changed[].fields` is a
 * list of { name } plus from/to for url, slug and content_type.
 */
export function diffRecords(current, proposed) {
  const currentById = new Map((current ?? []).map((r) => [r.objectID, r]));
  const proposedById = new Map((proposed ?? []).map((r) => [r.objectID, r]));

  const added = [];
  const removed = [];
  const changed = [];
  let unchangedCount = 0;

  for (const [objectID, next] of proposedById) {
    const prev = currentById.get(objectID);
    if (!prev) {
      added.push(identity(next));
      continue;
    }
    const names = new Set([...Object.keys(prev), ...Object.keys(next)]);
    names.delete('objectID');
    const fields = [];
    for (const name of names) {
      if (isDeepStrictEqual(prev[name], next[name])) continue;
      fields.push(
        VERBOSE_DIFF_FIELDS.has(name)
          ? { name, from: prev[name] ?? null, to: next[name] ?? null }
          : { name }
      );
    }
    if (fields.length === 0) unchangedCount += 1;
    else changed.push({ ...identity(next), fields });
  }

  for (const [objectID, prev] of currentById) {
    if (!proposedById.has(objectID)) removed.push(identity(prev));
  }

  return { added, removed, changed, unchangedCount };
}

// --- Export-file mode -------------------------------------------------------
// A Webflow export JSON stands in for the API when no token is available. The
// exporter cannot read the /live endpoint, so isLiveItem is the publish gate.

/** Validate an export payload and return its collection entries. */
export function normalizeExport(data) {
  if (!data || !Array.isArray(data.collections)) {
    throw new Error('Webflow export is missing a `collections` array');
  }
  // Without refs every reference silently resolves to null, which looks like drift.
  if (!data.refs || typeof data.refs !== 'object' || Array.isArray(data.refs)) {
    throw new Error('Webflow export is missing a `refs` object');
  }
  return data.collections.map((entry) => {
    const slug = entry?.schema?.slug;
    if (!slug) throw new Error('Webflow export has a collection without `schema.slug`');
    // A missing `items` would drop the whole collection from the index silently.
    if (!Array.isArray(entry.items)) {
      throw new Error(`Webflow export collection "${slug}" is missing an \`items\` array`);
    }
    return { schema: entry.schema, items: entry.items };
  });
}

/** A renamed collection would silently rewrite every /learn/ URL. */
export function assertExpectedSlug(config, schema) {
  if (schema.slug !== config.expectedSlug) {
    throw new Error(
      `Collection ${config.name} (${config.id}) slug is "${schema.slug}", expected "${config.expectedSlug}". Aborting.`
    );
  }
}

/**
 * Pair an export's entries with the collections we index, in COLLECTIONS order.
 * Entries for collections we do not index (Events, Webinars, anything new) are ignored.
 */
export function selectExportCollections(entries) {
  const byId = new Map(entries.map((entry) => [entry.schema.id, entry]));
  return COLLECTIONS.map((config) => {
    const entry = byId.get(config.id);
    if (!entry) throw new Error(`Export is missing collection ${config.name} (${config.id})`);
    assertExpectedSlug(config, entry.schema);
    return { config, schema: entry.schema, items: entry.items.filter(isLiveItem) };
  });
}

/** resolve(collectionId, itemId) over `export.refs`; misses call `onMissing`. */
export function createExportResolver(refs, onMissing) {
  return (collectionId, itemId) => {
    const item = refs?.[collectionId]?.[itemId] ?? null;
    if (!isLiveItem(item)) {
      if (onMissing) onMissing(collectionId, itemId);
      return null;
    }
    return item;
  };
}
