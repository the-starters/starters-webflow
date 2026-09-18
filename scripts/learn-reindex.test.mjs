// Unit tests for the LearnContent reindex mapping layer.
//   node --test scripts/learn-reindex.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  COLLECTIONS,
  REF_COLLECTIONS,
  buildUrl,
  collectionById,
  createExportResolver,
  diffRecords,
  isLiveItem,
  normalizeExport,
  optionMapsFromSchema,
  selectExportCollections,
  toUnixSeconds,
} from './learn-reindex-lib.mjs';

const INTERVIEWS = '69dca9df095d2fbcf34e255b';
const PLAYBOOKS = '69e1e416f6476e12f572b39b';
const SESSIONS = '69e08554183023227aa46c1e';
// Still in the CMS and in exports, deliberately not indexed.
const WEBINARS = '69e1fdfacbd0eddfd48c1495';
// Still in the CMS and in exports, deliberately not indexed.
const EVENTS = '69ef540fe8dc02d3ea4c0353';

const OPTION_IDS = {
  categoryNews: '5b08871e73ee914ab6b674ba384159e5',
  categoryInterviews: 'f1cf35b93dfe1a8c1b8d41ef64ab637d',
  categoryAnalysis: 'dfdc9ef816908a32f75380c6117fb96a',
  budget100k: '485117f633b9a931987a638d0f60bca6',
  typePlaybook: 'd4718636f103236b6f28035db92d2bb7',
  typeTemplate: '5161b2140dbbe044ff07dca1db836d77',
  stateUpcoming: '80fd0a85a306b8b1f25374a1f24bd651',
  labelUpcoming: '5be0583a18d56704e1b6476b86b032e4',
};

// Trimmed copies of the real `GET /collections/{id}` responses.
const SCHEMAS = {
  [INTERVIEWS]: {
    id: INTERVIEWS,
    slug: 'interviews-analysis',
    fields: [
      { slug: 'name', type: 'PlainText' },
      {
        slug: 'category',
        type: 'Option',
        validations: {
          options: [
            { id: OPTION_IDS.categoryNews, name: 'News' },
            { id: OPTION_IDS.categoryInterviews, name: 'Interviews' },
            { id: OPTION_IDS.categoryAnalysis, name: 'Analysis' },
          ],
        },
      },
      {
        slug: 'budget',
        type: 'Option',
        validations: {
          options: [
            { id: OPTION_IDS.budget100k, name: '$100k-1M' },
            { id: '160bda0199c2f3c911dabd89977286fb', name: '$2M-10M' },
            { id: 'b8c9e0e78291bde773f0b763be7159ee', name: '$10M-50M' },
          ],
        },
      },
    ],
  },
  [PLAYBOOKS]: {
    id: PLAYBOOKS,
    slug: 'playbooks-frameworks',
    fields: [
      {
        slug: 'type',
        type: 'Option',
        validations: {
          options: [
            { id: OPTION_IDS.typePlaybook, name: 'Playbook' },
            { id: OPTION_IDS.typeTemplate, name: 'Template' },
            { id: 'bdcf93d81e32864a9548599de1675032', name: 'Guide' },
            { id: '1c52e5d6b4b39502b7fc4d0e7f22f9f8', name: 'Framework' },
          ],
        },
      },
    ],
  },
  [SESSIONS]: { id: SESSIONS, slug: 'sessions', fields: [] },
  [WEBINARS]: {
    id: WEBINARS,
    slug: 'webinars',
    fields: [
      {
        slug: 'state',
        type: 'Option',
        validations: {
          options: [
            { id: OPTION_IDS.stateUpcoming, name: 'Upcoming' },
            { id: 'afb9357af6b1fed11b31bb46be7287c7', name: 'Live' },
          ],
        },
      },
    ],
  },
  [EVENTS]: {
    id: EVENTS,
    slug: 'event',
    fields: [
      {
        slug: 'label',
        type: 'Option',
        validations: {
          options: [
            { id: OPTION_IDS.labelUpcoming, name: 'Upcoming' },
            { id: 'd84d3bfb7a4af7ef96ea018018f799c8', name: 'Live' },
          ],
        },
      },
    ],
  },
};

const published = (extra) => ({ isArchived: false, lastPublished: '2026-09-01T00:00:00.000Z', ...extra });

const REF_ITEMS = {
  [REF_COLLECTIONS.freelancers]: {
    '6a188fb6bf283f471428d608': published({
      id: '6a188fb6bf283f471428d608',
      fieldData: { name: 'Emma Code', slug: 'emmahcodee', 'memberstack-id': 'mem_cm5b5n6zr057w0sioewr0etrf' },
    }),
    'author-no-memberstack': published({
      id: 'author-no-memberstack',
      fieldData: { name: 'No Member', slug: 'no-member', 'memberstack-id': null },
    }),
    'author-archived': { id: 'author-archived', isArchived: true, lastPublished: '2026-01-01T00:00:00.000Z', fieldData: { slug: 'jeff-he' } },
    'author-unpublished': { id: 'author-unpublished', isArchived: false, lastPublished: null, fieldData: { slug: 'tom-vasquez-demo' } },
  },
  [REF_COLLECTIONS.categories]: {
    '69f39e88043b8494a81e8f4e': published({ id: '69f39e88043b8494a81e8f4e', fieldData: { name: 'Creative & Brand', slug: 'creative-brand' } }),
    'cat-finance': published({ id: 'cat-finance', fieldData: { name: 'Finance', slug: 'finance' } }),
    'cat-paid-media': published({ id: 'cat-paid-media', fieldData: { name: 'Paid Media', slug: 'paid-media' } }),
  },
  [REF_COLLECTIONS.sessions]: {
    'session-a': published({ id: 'session-a', fieldData: { name: 'Session A', slug: 'session-a-slug' } }),
  },
};

function fakeResolver(refs = REF_ITEMS, onMissing) {
  return (collectionId, itemId) => {
    const item = refs?.[collectionId]?.[itemId] ?? null;
    if (!item) {
      if (onMissing) onMissing(collectionId, itemId);
      return null;
    }
    return item;
  };
}

function mapWith(collectionId, item, { resolve = fakeResolver(), slug, warnings } = {}) {
  const config = collectionById(collectionId);
  const schema = SCHEMAS[collectionId];
  return config.map({
    item,
    collectionSlug: slug ?? schema.slug,
    optionMaps: optionMapsFromSchema(schema),
    resolve,
    warnings,
  });
}

// --- Fixtures (real API shapes, trimmed) ------------------------------------

const INTERVIEW_ITEM = {
  id: '6a1f27f8a5c9009f33099679',
  lastPublished: '2026-09-04T09:27:47.286Z',
  lastUpdated: '2026-09-04T10:41:40.107Z',
  createdOn: '2026-06-02T18:59:03.995Z',
  isArchived: false,
  isDraft: true,
  fieldData: {
    'autor-3': '6a188fb6bf283f471428d608',
    'category-interviews': '69f39e88043b8494a81e8f4e',
    image: {
      fileId: '6a9a8c4a55232c9f5a3e5480',
      url: 'https://cdn.prod.website-files.com/69cccb525710adfc97070cec/6a9a8c4a55232c9f5a3e5480_emilycode_square.webp',
      alt: null,
    },
    'baner-image': { fileId: 'x', url: 'https://example.invalid/cover.png', alt: null },
    'description-2': 'The format is typical.',
    body: '<p>…</p>',
    category: OPTION_IDS.categoryNews,
    'publish-date': '2026-06-02T18:58:00.000Z',
    budget: null,
    featured: false,
    'most-read-block': false,
    'button-text': null,
    name: 'Why Brand Events Need a Rebrand',
    slug: 'emily-cody-brand-events-rebrand',
  },
};

const PLAYBOOK_ITEM = {
  id: 'playbook-1',
  lastPublished: '2026-08-01T12:00:00.000Z',
  createdOn: '2026-05-10T09:15:00.000Z',
  isArchived: false,
  isDraft: false,
  fieldData: {
    'author-2': 'author-no-memberstack',
    'category-3': ['cat-finance', 'cat-paid-media'],
    'list-cover---image': { fileId: 'y', url: 'https://cdn.example.invalid/playbook.png', alt: null },
    description: 'How to run the thing.',
    type: OPTION_IDS.typeTemplate,
    version: 'v2',
    'associated-session': ['session-a'],
    name: 'Budget Template',
    slug: 'budget-template',
  },
};

const SESSION_ITEM = {
  id: 'session-item-1',
  lastPublished: '2026-08-20T08:00:00.000Z',
  createdOn: '2026-03-03T10:00:00.000Z',
  isArchived: false,
  isDraft: false,
  fieldData: {
    'autor-starter': '6a188fb6bf283f471428d608',
    'sessions-category-2': 'cat-finance',
    'image-prev-2': { fileId: 'z', url: 'https://cdn.example.invalid/session.png', alt: null },
    description: 'A recorded session.',
    'time-watching': '42 min',
    'id-video-for-waching': '1234567',
    name: 'Scaling Finance Ops',
    slug: 'scaling-finance-ops',
  },
};

// --- Tests ------------------------------------------------------------------

test('toUnixSeconds converts ISO strings to integer unix seconds', () => {
  assert.equal(toUnixSeconds('2026-06-02T18:58:00.000Z'), 1780426680);
  assert.equal(toUnixSeconds('2026-06-02T18:58:00.000Z'), Math.floor(Date.parse('2026-06-02T18:58:00.000Z') / 1000));
  assert.equal(toUnixSeconds(null), null);
  assert.equal(toUnixSeconds(''), null);
  assert.equal(toUnixSeconds('not a date'), null);
  assert.equal(Number.isInteger(toUnixSeconds('2026-07-06T08:44:35.336Z')), true);
});

test('optionMapsFromSchema turns option ids into names', () => {
  const maps = optionMapsFromSchema(SCHEMAS[INTERVIEWS]);
  assert.deepEqual(maps.category, {
    [OPTION_IDS.categoryNews]: 'News',
    [OPTION_IDS.categoryInterviews]: 'Interviews',
    [OPTION_IDS.categoryAnalysis]: 'Analysis',
  });
  assert.equal(maps.budget[OPTION_IDS.budget100k], '$100k-1M');
  assert.equal(maps.name, undefined);
});

test('interview item maps to the expected Algolia record', async () => {
  const record = await mapWith(INTERVIEWS, INTERVIEW_ITEM);
  assert.deepEqual(record, {
    objectID: '6a1f27f8a5c9009f33099679',
    title: 'Why Brand Events Need a Rebrand',
    slug: 'emily-cody-brand-events-rebrand',
    url: '/learn/interviews-analysis/emily-cody-brand-events-rebrand',
    content_type: { lvl0: 'Interview & News', lvl1: 'Interview & News > News' },
    description: 'The format is typical.',
    thumbnail_url:
      'https://cdn.prod.website-files.com/69cccb525710adfc97070cec/6a9a8c4a55232c9f5a3e5480_emilycode_square.webp',
    date: 1780426680,
    published_on: Math.floor(Date.parse('2026-09-04T09:27:47.286Z') / 1000),
    author: 'emmahcodee',
    categories: ['creative-brand'],
    budget: null,
    featured: false,
    memberstack_id: 'mem_cm5b5n6zr057w0sioewr0etrf',
  });
});

test('isDraft on a published item does not change the mapping', async () => {
  assert.equal(INTERVIEW_ITEM.isDraft, true);
  const record = await mapWith(INTERVIEWS, INTERVIEW_ITEM);
  assert.equal(record.objectID, INTERVIEW_ITEM.id);
});

test('url is built from the collection slug the API returned, not a constant', async () => {
  assert.equal(buildUrl('interviews-analysis', 'a-slug'), '/learn/interviews-analysis/a-slug');
  const renamed = await mapWith(INTERVIEWS, INTERVIEW_ITEM, { slug: 'interviews-renamed' });
  assert.equal(renamed.url, '/learn/interviews-renamed/emily-cody-brand-events-rebrand');
});

test('every collection carries its expected slug and content_type', async () => {
  assert.deepEqual(
    COLLECTIONS.map((c) => [c.id, c.expectedSlug]),
    [
      [INTERVIEWS, 'interviews-analysis'],
      [PLAYBOOKS, 'playbooks-frameworks'],
      [SESSIONS, 'sessions'],
    ]
  );

  const interview = await mapWith(INTERVIEWS, INTERVIEW_ITEM);
  const playbook = await mapWith(PLAYBOOKS, PLAYBOOK_ITEM);
  const session = await mapWith(SESSIONS, SESSION_ITEM);

  assert.deepEqual(interview.content_type, { lvl0: 'Interview & News', lvl1: 'Interview & News > News' });
  assert.deepEqual(playbook.content_type, { lvl0: 'Playbook', lvl1: 'Playbook > Template' });
  assert.deepEqual(session.content_type, { lvl0: 'Session' });

  assert.equal(playbook.url, '/learn/playbooks-frameworks/budget-template');
  assert.equal(session.url, '/learn/sessions/scaling-finance-ops');
});

test('Webinars are not indexed', () => {
  assert.equal(collectionById(WEBINARS), null);
  assert.equal(COLLECTIONS.some((c) => c.expectedSlug === 'webinars'), false);
});

test('Events are not indexed', () => {
  assert.equal(collectionById(EVENTS), null);
  assert.equal(COLLECTIONS.some((c) => c.expectedSlug === 'event'), false);
});

test('the Interviews resource type is indexed as the singular "Interview"', async () => {
  const item = { ...INTERVIEW_ITEM, fieldData: { ...INTERVIEW_ITEM.fieldData, category: OPTION_IDS.categoryInterviews } };
  const record = await mapWith(INTERVIEWS, item);
  assert.equal(record.content_type.lvl1, 'Interview & News > Interview');

  const analysis = { ...INTERVIEW_ITEM, fieldData: { ...INTERVIEW_ITEM.fieldData, category: OPTION_IDS.categoryAnalysis } };
  assert.equal((await mapWith(INTERVIEWS, analysis)).content_type.lvl1, 'Interview & News > Analysis');
});

test('a missing option id omits lvl1 rather than inventing one', async () => {
  const item = { ...INTERVIEW_ITEM, fieldData: { ...INTERVIEW_ITEM.fieldData, category: null } };
  const record = await mapWith(INTERVIEWS, item);
  assert.deepEqual(record.content_type, { lvl0: 'Interview & News' });
});

test('an option id the schema does not know about is recorded as a warning', async () => {
  const warnings = [];
  const item = { ...INTERVIEW_ITEM, fieldData: { ...INTERVIEW_ITEM.fieldData, category: 'retired-option-id' } };
  const record = await mapWith(INTERVIEWS, item, { warnings });
  // Behaviour is unchanged: lvl1 is omitted rather than invented.
  assert.deepEqual(record.content_type, { lvl0: 'Interview & News' });
  assert.deepEqual(warnings, [
    `Item ${INTERVIEW_ITEM.id} (interviews-analysis): option id retired-option-id not in schema field category`,
  ]);
});

test('a missing date on a dated collection warns and falls back to createdOn', async () => {
  const warnings = [];
  const item = { ...INTERVIEW_ITEM, fieldData: { ...INTERVIEW_ITEM.fieldData, 'publish-date': null } };
  const record = await mapWith(INTERVIEWS, item, { warnings });
  assert.equal(record.date, Math.floor(Date.parse(INTERVIEW_ITEM.createdOn) / 1000));
  assert.deepEqual(warnings, [
    `Item ${INTERVIEW_ITEM.id} (interviews-analysis): no publish-date date, falling back to createdOn`,
  ]);
});

test('a record left with no date at all warns instead of shipping silently', async () => {
  const warnings = [];
  const { createdOn, ...noCreatedOn } = SESSION_ITEM;
  const record = await mapWith(SESSIONS, noCreatedOn, { warnings });
  assert.equal(record.date, null);
  assert.deepEqual(warnings, [
    `Item ${SESSION_ITEM.id} (sessions): no date and no createdOn, indexed with date null`,
  ]);
});

test('collections with no date field never warn about one', async () => {
  const warnings = [];
  await mapWith(PLAYBOOKS, PLAYBOOK_ITEM, { warnings });
  await mapWith(SESSIONS, SESSION_ITEM, { warnings });
  assert.deepEqual(warnings, []);
});

test('mappers work without a warnings array', async () => {
  const item = { ...INTERVIEW_ITEM, fieldData: { ...INTERVIEW_ITEM.fieldData, 'publish-date': null, category: 'gone' } };
  const record = await mapWith(INTERVIEWS, item);
  assert.deepEqual(record.content_type, { lvl0: 'Interview & News' });
  assert.equal(record.date, Math.floor(Date.parse(INTERVIEW_ITEM.createdOn) / 1000));
});

test('budget options resolve to their display names', async () => {
  const item = { ...INTERVIEW_ITEM, fieldData: { ...INTERVIEW_ITEM.fieldData, budget: OPTION_IDS.budget100k } };
  assert.equal((await mapWith(INTERVIEWS, item)).budget, '$100k-1M');
});

test('playbook maps author, categories, version, sessions and the constant gate', async () => {
  const record = await mapWith(PLAYBOOKS, PLAYBOOK_ITEM);
  assert.equal(record.author, 'no-member');
  assert.equal(record.memberstack_id, null);
  assert.deepEqual(record.categories, ['finance', 'paid-media']);
  assert.equal(record.version, 'v2');
  assert.deepEqual(record.associated_sessions, ['session-a-slug']);
  assert.equal(record.gated, false);
  // No date field on this collection: createdOn is the fallback.
  assert.equal(record.date, Math.floor(Date.parse('2026-05-10T09:15:00.000Z') / 1000));
});

test('session maps its single category reference into an array', async () => {
  const record = await mapWith(SESSIONS, SESSION_ITEM);
  assert.deepEqual(record.categories, ['finance']);
  assert.equal(record.author, 'emmahcodee');
  assert.equal(record.memberstack_id, 'mem_cm5b5n6zr057w0sioewr0etrf');
  assert.equal(record.time_watching, '42 min');
  assert.equal(record.video_id, '1234567');
  assert.equal(record.date, Math.floor(Date.parse('2026-03-03T10:00:00.000Z') / 1000));
});

test('unresolvable references map to nulls and empty arrays', async () => {
  const missing = [];
  const resolve = fakeResolver(REF_ITEMS, (collectionId, itemId) => missing.push(`${collectionId}/${itemId}`));
  const item = {
    ...INTERVIEW_ITEM,
    fieldData: { ...INTERVIEW_ITEM.fieldData, 'autor-3': 'gone-author', 'category-interviews': 'gone-category' },
  };
  const record = await mapWith(INTERVIEWS, item, { resolve });
  assert.equal(record.author, null);
  assert.equal(record.memberstack_id, null);
  assert.deepEqual(record.categories, []);
  assert.deepEqual(missing, [
    `${REF_COLLECTIONS.freelancers}/gone-author`,
    `${REF_COLLECTIONS.categories}/gone-category`,
  ]);
});

test('a reference that resolves without a slug is dropped with a warning', async () => {
  const warnings = [];
  const refs = {
    ...REF_ITEMS,
    [REF_COLLECTIONS.categories]: {
      ...REF_ITEMS[REF_COLLECTIONS.categories],
      'cat-slugless': published({ id: 'cat-slugless', fieldData: { name: 'No Slug' } }),
    },
  };
  const item = {
    ...INTERVIEW_ITEM,
    fieldData: { ...INTERVIEW_ITEM.fieldData, 'category-interviews': 'cat-slugless' },
  };
  const record = await mapWith(INTERVIEWS, item, { resolve: fakeResolver(refs), warnings });
  assert.deepEqual(record.categories, []);
  assert.deepEqual(warnings, [
    `Item ${INTERVIEW_ITEM.id} (interviews-analysis): reference ${REF_COLLECTIONS.categories}/cat-slugless has no slug, dropped`,
  ]);
});

test('a slugless author is dropped with a warning but keeps its memberstack id', async () => {
  const warnings = [];
  const refs = {
    ...REF_ITEMS,
    [REF_COLLECTIONS.freelancers]: {
      ...REF_ITEMS[REF_COLLECTIONS.freelancers],
      'author-slugless': published({ id: 'author-slugless', fieldData: { 'memberstack-id': 'mem_keepme' } }),
    },
  };
  const item = { ...INTERVIEW_ITEM, fieldData: { ...INTERVIEW_ITEM.fieldData, 'autor-3': 'author-slugless' } };
  const record = await mapWith(INTERVIEWS, item, { resolve: fakeResolver(refs), warnings });
  assert.equal(record.author, null);
  assert.equal(record.memberstack_id, 'mem_keepme');
  assert.deepEqual(warnings, [
    `Item ${INTERVIEW_ITEM.id} (interviews-analysis): reference ${REF_COLLECTIONS.freelancers}/author-slugless has no slug, dropped`,
  ]);
});

test('items with no reference values at all still map cleanly', async () => {
  const bare = {
    id: 'bare-1',
    lastPublished: '2026-08-01T00:00:00.000Z',
    createdOn: '2026-07-01T00:00:00.000Z',
    isArchived: false,
    isDraft: false,
    fieldData: { name: 'Bare', slug: 'bare' },
  };
  const record = await mapWith(PLAYBOOKS, bare);
  assert.equal(record.thumbnail_url, null);
  assert.equal(record.description, null);
  assert.equal(record.author, null);
  assert.equal(record.memberstack_id, null);
  assert.equal(record.version, null);
  assert.deepEqual(record.categories, []);
  assert.deepEqual(record.associated_sessions, []);
  assert.equal(record.gated, false);
  assert.equal(record.date, Math.floor(Date.parse('2026-07-01T00:00:00.000Z') / 1000));
});

test('diffRecords reports added, removed, changed and unchanged', () => {
  const current = [
    { objectID: 'keep', title: 'Keep', url: '/learn/sessions/keep', description: 'same' },
    { objectID: 'drop', title: 'Drop', url: '/learn/old/drop' },
    {
      objectID: 'move',
      title: 'Move',
      url: '/learn/interviews/move',
      slug: 'move',
      content_type: { lvl0: 'Interview & News' },
      description: 'before',
      categories: ['finance'],
    },
  ];
  const proposed = [
    { objectID: 'keep', title: 'Keep', url: '/learn/sessions/keep', description: 'same' },
    { objectID: 'new', title: 'New', url: '/learn/sessions/new' },
    {
      objectID: 'move',
      title: 'Move',
      url: '/learn/interviews-analysis/move',
      slug: 'move',
      content_type: { lvl0: 'Interview & News', lvl1: 'Interview & News > News' },
      description: 'after',
      categories: ['finance'],
    },
  ];

  const diff = diffRecords(current, proposed);
  assert.deepEqual(diff.added, [{ objectID: 'new', title: 'New', url: '/learn/sessions/new' }]);
  assert.deepEqual(diff.removed, [{ objectID: 'drop', title: 'Drop', url: '/learn/old/drop' }]);
  assert.equal(diff.unchangedCount, 1);
  assert.equal(diff.changed.length, 1);

  const [changed] = diff.changed;
  assert.equal(changed.objectID, 'move');
  assert.deepEqual(
    changed.fields.map((f) => f.name).sort(),
    ['content_type', 'description', 'url']
  );
  const url = changed.fields.find((f) => f.name === 'url');
  assert.deepEqual(url, { name: 'url', from: '/learn/interviews/move', to: '/learn/interviews-analysis/move' });
  const contentType = changed.fields.find((f) => f.name === 'content_type');
  assert.deepEqual(contentType.to, { lvl0: 'Interview & News', lvl1: 'Interview & News > News' });
  // Non-verbose fields carry the name only.
  assert.deepEqual(changed.fields.find((f) => f.name === 'description'), { name: 'description' });
});

test('isLiveItem gates items and references alike', () => {
  assert.equal(isLiveItem({ id: 'x', isArchived: false, lastPublished: '2026-09-04T09:27:47.286Z', isDraft: true }), true);
  assert.equal(isLiveItem({ isArchived: false, lastPublished: '2026-09-04T09:27:47.286Z' }), false);
  assert.equal(isLiveItem({ isArchived: false, lastPublished: null }), false);
  assert.equal(isLiveItem({ isArchived: false, lastPublished: '' }), false);
  assert.equal(isLiveItem({ isArchived: true, lastPublished: '2026-09-04T09:27:47.286Z' }), false);
  assert.equal(isLiveItem(null), false);
  assert.equal(isLiveItem(undefined), false);
});

test('archived or unpublished references count as missing', () => {
  assert.equal(isLiveItem(REF_ITEMS[REF_COLLECTIONS.freelancers]['author-archived']), false);
  assert.equal(isLiveItem(REF_ITEMS[REF_COLLECTIONS.freelancers]['author-unpublished']), false);
  assert.equal(isLiveItem(REF_ITEMS[REF_COLLECTIONS.freelancers]['6a188fb6bf283f471428d608']), true);

  const missing = [];
  const resolve = createExportResolver(REF_ITEMS, (c, i) => missing.push(`${c}/${i}`));
  assert.equal(resolve(REF_COLLECTIONS.freelancers, 'author-archived'), null);
  assert.equal(resolve(REF_COLLECTIONS.freelancers, 'author-unpublished'), null);
  assert.equal(resolve(REF_COLLECTIONS.freelancers, 'not-in-export'), null);
  assert.equal(resolve(REF_COLLECTIONS.freelancers, '6a188fb6bf283f471428d608').fieldData.slug, 'emmahcodee');
  assert.deepEqual(missing, [
    `${REF_COLLECTIONS.freelancers}/author-archived`,
    `${REF_COLLECTIONS.freelancers}/author-unpublished`,
    `${REF_COLLECTIONS.freelancers}/not-in-export`,
  ]);
});

test('a minimal export object maps through the export-mode loader', async () => {
  const exported = {
    exportedAt: '2026-09-18T09:57:54.966185+00:00',
    collections: [
      {
        schema: SCHEMAS[INTERVIEWS],
        items: [
          INTERVIEW_ITEM,
          { ...INTERVIEW_ITEM, id: 'archived-1', isArchived: true },
          { ...INTERVIEW_ITEM, id: 'unpublished-1', lastPublished: null },
        ],
      },
    ],
    refs: REF_ITEMS,
  };

  const entries = normalizeExport(exported);
  assert.equal(entries.length, 1);
  assert.equal(entries[0].schema.slug, 'interviews-analysis');

  const dangling = [];
  const resolve = createExportResolver(exported.refs, (c, i) => dangling.push(`${c}/${i}`));
  const config = collectionById(entries[0].schema.id);
  const optionMaps = optionMapsFromSchema(entries[0].schema);

  const records = [];
  for (const item of entries[0].items.filter(isLiveItem)) {
    records.push(await config.map({ item, collectionSlug: entries[0].schema.slug, optionMaps, resolve }));
  }

  assert.equal(records.length, 1);
  assert.equal(records[0].url, '/learn/interviews-analysis/emily-cody-brand-events-rebrand');
  assert.equal(records[0].author, 'emmahcodee');
  assert.deepEqual(dangling, []);
});

test('an export that still carries Events and Webinars yields only the three indexed collections', () => {
  const entry = (id, slug, items = []) => ({ schema: { ...SCHEMAS[id], id, slug }, items });
  const stub = (slug) => ({ id: slug, isArchived: false, lastPublished: '2026-09-01T00:00:00.000Z', fieldData: { slug } });
  const exported = {
    collections: [
      entry(INTERVIEWS, 'interviews-analysis', [INTERVIEW_ITEM]),
      entry(PLAYBOOKS, 'playbooks-frameworks', [PLAYBOOK_ITEM]),
      entry(SESSIONS, 'sessions', [SESSION_ITEM]),
      entry(WEBINARS, 'webinars', [stub('a-webinar')]),
      entry(EVENTS, 'event', [stub('an-event')]),
    ],
    refs: REF_ITEMS,
  };

  assert.equal(exported.collections.length, 5);
  const selected = selectExportCollections(normalizeExport(exported));
  assert.deepEqual(
    selected.map((s) => [s.config.expectedSlug, s.items.length]),
    [
      ['interviews-analysis', 1],
      ['playbooks-frameworks', 1],
      ['sessions', 1],
    ]
  );
});

test('selectExportCollections rejects a renamed or absent collection', () => {
  const entry = (id, slug) => ({ schema: { ...SCHEMAS[id], id, slug }, items: [] });
  const three = [
    entry(INTERVIEWS, 'interviews-analysis'),
    entry(PLAYBOOKS, 'playbooks-frameworks'),
    entry(SESSIONS, 'sessions'),
  ];
  assert.throws(() => selectExportCollections(three.slice(1)), /missing collection Interview & News/);
  assert.throws(
    () => selectExportCollections([entry(INTERVIEWS, 'interviews-renamed'), ...three.slice(1)]),
    /slug is "interviews-renamed"/
  );
});

test('normalizeExport rejects a payload it cannot trust', () => {
  assert.throws(() => normalizeExport(null), /collections/);
  assert.throws(() => normalizeExport({ collections: [{ schema: {} }], refs: {} }), /schema\.slug/);
  assert.throws(() => normalizeExport({ collections: [] }), /refs/);
  assert.throws(() => normalizeExport({ collections: [], refs: null }), /refs/);
  assert.throws(() => normalizeExport({ collections: [], refs: [] }), /refs/);
  const noItems = { schema: { ...SCHEMAS[WEBINARS], id: WEBINARS, slug: 'webinars' } };
  assert.throws(() => normalizeExport({ collections: [noItems], refs: REF_ITEMS }), /webinars.*items/);
  assert.throws(
    () => normalizeExport({ collections: [{ ...noItems, items: {} }], refs: REF_ITEMS }),
    /webinars.*items/
  );
});

test('an item with no slug is rejected rather than given an /undefined URL', async () => {
  const slugless = {
    id: 'slugless-1',
    lastPublished: '2026-09-01T00:00:00.000Z',
    createdOn: '2026-07-01T00:00:00.000Z',
    isArchived: false,
    isDraft: false,
    fieldData: { name: 'No Slug' },
  };
  assert.equal(isLiveItem(slugless), true);
  await assert.rejects(() => mapWith(PLAYBOOKS, slugless), /slugless-1.*no slug/);
});
