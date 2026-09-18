// Pure mapping layer for the LearnContent reindex. No network, no secrets, no
// file I/O — everything here is unit-testable with fake data.
//
// Webflow CMS item -> Algolia record. Reference fields (authors, categories,
// speakers, sessions) are resolved through an injected
// `resolve(collectionId, itemId) -> item | null` so tests can fake them.

// Referenced collections. Ids are the live Webflow collection ids.
export const REF_COLLECTIONS = {
  freelancers: '69f241ec147b71addb6f1531',
  categories: '69f2329d4f5bacf6765c1ca1',
  people: '69e1fe14e646a7b8e1cb58ca',
  sessions: '69e08554183023227aa46c1e',
};

export const LEARN_URL_PREFIX = '/learn';

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

function optionName(optionMaps, fieldSlug, optionId) {
  if (!optionId) return null;
  return optionMaps?.[fieldSlug]?.[optionId] ?? null;
}

function imageUrl(value) {
  return value?.url ?? null;
}

function idList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

/** Resolve reference ids to their item slugs; unresolved refs drop out. */
async function slugsFor(resolve, collectionId, value) {
  const slugs = [];
  for (const id of idList(value)) {
    const item = await resolve(collectionId, id);
    const slug = item?.fieldData?.slug;
    if (slug) slugs.push(slug);
  }
  return slugs;
}

/** Freelancer reference -> { author slug, memberstack id }; both null when missing. */
async function authorFrom(resolve, id) {
  if (!id) return { author: null, memberstack_id: null };
  const item = await resolve(REF_COLLECTIONS.freelancers, id);
  if (!item) return { author: null, memberstack_id: null };
  return {
    author: item.fieldData?.slug ?? null,
    memberstack_id: item.fieldData?.['memberstack-id'] ?? null,
  };
}

async function memberstackIdsFor(resolve, value) {
  const ids = [];
  for (const id of idList(value)) {
    const item = await resolve(REF_COLLECTIONS.freelancers, id);
    const memberstackId = item?.fieldData?.['memberstack-id'];
    if (memberstackId) ids.push(memberstackId);
  }
  return ids;
}

function contentType(lvl0, lvl1) {
  return lvl1 ? { lvl0, lvl1 } : { lvl0 };
}

function core({ item, collectionSlug, lvl0, lvl1, description, thumbnail, date, author, categories }) {
  const fieldData = item.fieldData ?? {};
  const slug = fieldData.slug;
  if (!slug) {
    throw new Error(`Item ${item.id} in /learn/${collectionSlug}/ has no slug, so it has no page URL`);
  }
  return {
    objectID: item.id,
    title: fieldData.name ?? null,
    slug,
    url: buildUrl(collectionSlug, slug),
    content_type: contentType(lvl0, lvl1),
    description: description ?? null,
    thumbnail_url: thumbnail ?? null,
    date: date ?? toUnixSeconds(item.createdOn),
    published_on: toUnixSeconds(item.lastPublished),
    author,
    categories,
  };
}

async function mapInterview({ item, collectionSlug, optionMaps, resolve }) {
  const f = item.fieldData ?? {};
  const { author, memberstack_id } = await authorFrom(resolve, f['autor-3']);
  const resourceType = optionName(optionMaps, 'category', f.category);
  const lvl1 = resourceType
    ? `Interview & News > ${INTERVIEW_LVL1_ALIASES[resourceType] ?? resourceType}`
    : null;
  return {
    ...core({
      item,
      collectionSlug,
      lvl0: 'Interview & News',
      lvl1,
      description: f['description-2'] ?? null,
      thumbnail: imageUrl(f.image),
      date: toUnixSeconds(f['publish-date']),
      author,
      categories: await slugsFor(resolve, REF_COLLECTIONS.categories, f['category-interviews']),
    }),
    budget: optionName(optionMaps, 'budget', f.budget),
    featured: f.featured === true,
    memberstack_id,
  };
}

async function mapPlaybook({ item, collectionSlug, optionMaps, resolve }) {
  const f = item.fieldData ?? {};
  const { author, memberstack_id } = await authorFrom(resolve, f['author-2']);
  const type = optionName(optionMaps, 'type', f.type);
  return {
    ...core({
      item,
      collectionSlug,
      lvl0: 'Playbook',
      lvl1: type ? `Playbook > ${type}` : null,
      description: f.description ?? null,
      thumbnail: imageUrl(f['list-cover---image']),
      date: null, // no date field on this collection; core falls back to createdOn
      author,
      categories: await slugsFor(resolve, REF_COLLECTIONS.categories, f['category-3']),
    }),
    version: f.version ?? null,
    associated_sessions: await slugsFor(resolve, REF_COLLECTIONS.sessions, f['associated-session']),
    gated: false, // no source field in Webflow; every existing record carries false
    memberstack_id,
  };
}

async function mapSession({ item, collectionSlug, resolve }) {
  const f = item.fieldData ?? {};
  const { author, memberstack_id } = await authorFrom(resolve, f['autor-starter']);
  return {
    ...core({
      item,
      collectionSlug,
      lvl0: 'Session',
      lvl1: null,
      description: f.description ?? null,
      thumbnail: imageUrl(f['image-prev-2']),
      date: null, // no date field on this collection
      author,
      categories: await slugsFor(resolve, REF_COLLECTIONS.categories, f['sessions-category-2']),
    }),
    time_watching: f['time-watching'] ?? null,
    video_id: f['id-video-for-waching'] ?? null,
    memberstack_id,
  };
}

async function mapWebinar({ item, collectionSlug, optionMaps, resolve }) {
  const f = item.fieldData ?? {};
  return {
    ...core({
      item,
      collectionSlug,
      lvl0: 'Webinar',
      lvl1: null,
      description: f['short-description'] ?? null,
      thumbnail: imageUrl(f.image),
      date: toUnixSeconds(f.date),
      author: null, // collection has no author field
      categories: [], // collection has no category field
    }),
    state: optionName(optionMaps, 'state', f.state),
    location: f.location ?? null,
    speakers: await slugsFor(resolve, REF_COLLECTIONS.people, f.speackers),
    memberstack_ids: [], // no freelancer reference on webinars
    memberstack_id: null,
  };
}

async function mapEvent({ item, collectionSlug, optionMaps, resolve }) {
  const f = item.fieldData ?? {};
  return {
    ...core({
      item,
      collectionSlug,
      lvl0: 'Event',
      lvl1: null,
      description: f['short-description'] ?? null,
      thumbnail: imageUrl(f['hero-image']),
      date: toUnixSeconds(f['date-and-time']),
      author: null, // collection has no author field
      categories: await slugsFor(resolve, REF_COLLECTIONS.categories, f.categories),
    }),
    label: optionName(optionMaps, 'label', f.label),
    location: f.location ?? null,
    speakers: await slugsFor(resolve, REF_COLLECTIONS.people, f.speakers),
    memberstack_ids: await memberstackIdsFor(resolve, f.speakers2),
    featured: f.featured === true,
    join_event_url: f['join-event-url'] ?? null,
    memberstack_id: null,
  };
}

// Podcasts are deliberately absent: the Lists collection has no page.
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
  {
    name: 'Webinars',
    id: '69e1fdfacbd0eddfd48c1495',
    expectedSlug: 'webinars',
    map: mapWebinar,
  },
  {
    name: 'Events',
    id: '69ef540fe8dc02d3ea4c0353',
    expectedSlug: 'event',
    map: mapEvent,
  },
];

export function collectionById(id) {
  return COLLECTIONS.find((c) => c.id === id) ?? null;
}

/** An item belongs in the index only when it is live and not archived. */
export function isIndexable(item) {
  return Boolean(item?.id) && item.isArchived !== true;
}

export function stripHighlight(hit) {
  const { _highlightResult, _snippetResult, ...rest } = hit ?? {};
  return rest;
}

function deepEqual(a, b) {
  if (a === b) return true;
  if (Array.isArray(a) && Array.isArray(b)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a);
    const kb = Object.keys(b);
    if (ka.length !== kb.length) return false;
    return ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEqual(a[k], b[k]));
  }
  return false;
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
      if (deepEqual(prev[name], next[name])) continue;
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
// exporter cannot read the /live endpoint, so the publish gate is applied here.

/** Export stand-in for the /live endpoint: published and not archived. */
export function isPublishedForExport(item) {
  return (
    item?.isArchived === false &&
    typeof item.lastPublished === 'string' &&
    item.lastPublished !== ''
  );
}

/** A reference resolves only when the API's /live lookup would not 404 on it. */
export function isResolvableRef(item) {
  return (
    Boolean(item) &&
    item.isArchived !== true &&
    typeof item.lastPublished === 'string' &&
    item.lastPublished !== ''
  );
}

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
    return { schema: entry.schema, items: Array.isArray(entry.items) ? entry.items : [] };
  });
}

/** resolve(collectionId, itemId) over `export.refs`; misses call `onMissing`. */
export function createExportResolver(refs, onMissing) {
  return (collectionId, itemId) => {
    const item = refs?.[collectionId]?.[itemId] ?? null;
    if (!isResolvableRef(item)) {
      if (onMissing) onMissing(collectionId, itemId);
      return null;
    }
    return item;
  };
}
