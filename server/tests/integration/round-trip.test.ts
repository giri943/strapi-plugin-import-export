import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parse } from 'csv-parse/sync';
import { buildColumns } from '../../src/core/schema';
import { createSchemaResolver } from '../../src/utils/strapi-schema';
import { PLUGIN_ACTIONS } from '../../src/permissions';
import type { ColumnDescriptor, ImportMode } from '../../src/core/types';
import {
  ARTICLE_UID,
  AUTHOR_UID,
  TAG_UID,
  bootStrapi,
  discardTempCsv,
  writeTempCsv,
  type BootedStrapi,
} from './boot';

let app: BootedStrapi;
let columns: ColumnDescriptor[];

const collection = {
  enabled: true,
  allowImport: true,
  allowExport: true,
  excludeFields: [] as string[],
  relationLookupKeys: { [AUTHOR_UID]: 'email', [TAG_UID]: 'slug' },
  identifierField: 'documentId',
};

async function settings() {
  return app.plugin().service('settings').get();
}

async function runImport(options: {
  csv: string;
  mode?: ImportMode;
  dryRun?: boolean;
  canPublish?: boolean;
}) {
  const filePath = await writeTempCsv(options.csv);

  try {
    return await app.plugin().service('import').run({
      uid: ARTICLE_UID,
      filePath,
      columns,
      settings: await settings(),
      collection,
      mode: options.mode ?? 'upsert',
      dryRun: options.dryRun ?? false,
      canPublish: options.canPublish ?? true,
    });
  } finally {
    await discardTempCsv(filePath);
  }
}

const articles = () => app.strapi.documents(ARTICLE_UID);

async function findArticle(title: string) {
  const rows = await articles().findMany({
    filters: { title },
    populate: {
      author: { fields: ['email'] },
      tags: { fields: ['slug'] },
      seo: true,
      faq: true,
      sections: { on: { 'blocks.hero': { populate: '*' }, 'blocks.cta': { populate: '*' } } },
    },
    status: 'draft',
  });

  return rows?.[0];
}

beforeAll(async () => {
  app = await bootStrapi();

  columns = buildColumns(createSchemaResolver(app.strapi), ARTICLE_UID, {
    repeatableColumns: 2,
    relationLookupKeys: collection.relationLookupKeys,
    mediaLookupKey: 'name',
  });

  await app.strapi.documents(AUTHOR_UID).create({
    data: { name: 'Ada Lovelace', email: 'ada@example.com' },
  });
  await app.strapi.documents(TAG_UID).create({ data: { name: 'News', slug: 'news' } });
  await app.strapi.documents(TAG_UID).create({ data: { name: 'Sport', slug: 'sport' } });
});

afterAll(async () => {
  if (app) await app.stop();
});

describe('the plugin loads into a real Strapi app', () => {
  it('registers its services', () => {
    for (const name of ['settings', 'schema', 'rbac', 'template', 'export', 'import', 'jobs']) {
      expect(app.plugin().service(name), name).toBeDefined();
    }
  });

  it('registers every admin permission action', () => {
    const provider = app.strapi.service('admin::permission').actionProvider;

    // Read from the source of truth rather than a literal, so a renamed action fails the unit
    // test that owns the naming rules instead of silently passing here.
    for (const actionId of Object.values(PLUGIN_ACTIONS)) {
      expect(provider.get(actionId), `${actionId} should be registered`).toBeDefined();
    }
  });

  it('creates the import job content type without exposing it on the content API', () => {
    const schema = app.strapi.contentTypes['plugin::strapi-import-export.import-job'];

    expect(schema).toBeDefined();
    expect(schema.pluginOptions?.['content-api']?.exposed).toBe(false);
  });

  it('applies the seed from config/plugins.js on first boot', async () => {
    const stored = await settings();

    expect(stored.collections[ARTICLE_UID]?.enabled).toBe(true);
    expect(stored.collections[ARTICLE_UID]?.relationLookupKeys[AUTHOR_UID]).toBe('email');
  });
});

describe('schema discovery against a real schema', () => {
  it('finds the collections an administrator can enable', () => {
    const uids = app
      .plugin()
      .service('schema')
      .listCandidates()
      .map((candidate: { uid: string }) => candidate.uid);

    expect(uids).toEqual(expect.arrayContaining([ARTICLE_UID, AUTHOR_UID, TAG_UID]));
  });

  it('never offers the upload, admin or job tables', () => {
    const uids = app
      .plugin()
      .service('schema')
      .listCandidates()
      .map((candidate: { uid: string }) => candidate.uid);

    expect(uids).not.toContain('plugin::upload.file');
    expect(uids).not.toContain('admin::user');
    expect(uids).not.toContain('plugin::strapi-import-export.import-job');
  });

  it('builds the columns a template would carry', () => {
    const headers = columns.map((column) => column.header);

    expect(headers).toEqual(
      expect.arrayContaining([
        'documentId',
        'status',
        'title',
        'slug',
        'state',
        'metadata',
        'seo.metaTitle',
        'faq[0].question',
        'sections',
        'author:email',
        'tags:slug',
        'cover:name',
      ])
    );
  });

  it('leaves the private field out of the real schema too', () => {
    expect(columns.map((column) => column.header)).not.toContain('internalNote');
  });
});

describe('import against a real database', () => {
  it('creates an entry with scalars, a component and relations', async () => {
    const outcome = await runImport({
      csv: [
        'title,body,views,rating,featured,state,publishDate,metadata,seo.metaTitle,author:email,tags:slug',
        'Real Import,Body text,12,4.5,true,review,2026-03-01,"{""k"":1}",Meta here,ada@example.com,news;sport',
      ].join('\n'),
    });

    expect(outcome.aborted).toBeUndefined();
    expect(outcome.errors).toEqual([]);
    expect(outcome.counters.created).toBe(1);

    const article = await findArticle('Real Import');

    expect(article).toBeDefined();
    expect(article.body).toBe('Body text');
    expect(article.views).toBe(12);
    expect(Number(article.rating)).toBe(4.5);
    expect(article.featured).toBe(true);
    expect(article.state).toBe('review');
    expect(article.metadata).toEqual({ k: 1 });
    expect(article.seo?.metaTitle).toBe('Meta here');
    expect(article.author?.email).toBe('ada@example.com');
    expect((article.tags ?? []).map((tag: { slug: string }) => tag.slug).sort()).toEqual([
      'news',
      'sport',
    ]);
  });

  it('writes a repeatable component in order', async () => {
    const outcome = await runImport({
      csv: [
        'title,faq[0].question,faq[0].answer,faq[1].question,faq[1].answer',
        'Repeatable Import,Q one,A one,Q two,A two',
      ].join('\n'),
    });

    expect(outcome.errors).toEqual([]);

    const article = await findArticle('Repeatable Import');
    const faq = (article.faq ?? []) as Array<{ question: string; answer: string }>;

    expect(faq.map((entry) => entry.question)).toEqual(['Q one', 'Q two']);
    expect(faq.map((entry) => entry.answer)).toEqual(['A one', 'A two']);
  });

  it('writes a dynamic zone from a JSON cell', async () => {
    const zone = JSON.stringify([
      { __component: 'blocks.hero', heading: 'The hero' },
      { __component: 'blocks.cta', label: 'Click', url: 'https://example.com' },
    ]).replace(/"/g, '""');

    const outcome = await runImport({
      csv: ['title,sections', `Zone Import,"${zone}"`].join('\n'),
    });

    expect(outcome.errors).toEqual([]);

    const article = await findArticle('Zone Import');
    const sections = (article.sections ?? []) as Array<Record<string, unknown>>;

    expect(sections).toHaveLength(2);
    expect(sections[0].__component).toBe('blocks.hero');
    expect(sections[0].heading).toBe('The hero');
    expect(sections[1].__component).toBe('blocks.cta');
    expect(sections[1].label).toBe('Click');
  });

  it('updates an existing entry matched on documentId', async () => {
    const created = await articles().create({ data: { title: 'Before Update' } });

    const outcome = await runImport({
      csv: ['documentId,title,body', `${created.documentId},After Update,Changed body`].join('\n'),
    });

    expect(outcome.counters.updated).toBe(1);
    expect(outcome.counters.created).toBe(0);

    const reloaded = await articles().findOne({ documentId: created.documentId, status: 'draft' });

    expect(reloaded.title).toBe('After Update');
    expect(reloaded.body).toBe('Changed body');
  });

  it('publishes a row whose status column says published', async () => {
    const outcome = await runImport({
      csv: ['title,status', 'Published Import,published'].join('\n'),
    });

    expect(outcome.errors).toEqual([]);

    const published = await articles().findMany({
      filters: { title: 'Published Import' },
      status: 'published',
    });

    expect(published).toHaveLength(1);
  });

  it('leaves the published version alone when a row says draft', async () => {
    const created = await articles().create({
      data: { title: 'Stays Published' },
      status: 'published',
    });

    await runImport({
      csv: ['documentId,title,status', `${created.documentId},Stays Published Edited,draft`].join(
        '\n'
      ),
    });

    const stillPublished = await articles().findMany({
      filters: { documentId: created.documentId },
      status: 'published',
    });

    expect(stillPublished).toHaveLength(1);
  });

  it('fails only the row whose relation is missing', async () => {
    const outcome = await runImport({
      csv: [
        'title,author:email',
        'Good Relation,ada@example.com',
        'Bad Relation,nobody@example.com',
      ].join('\n'),
    });

    expect(outcome.counters.created).toBe(1);
    expect(outcome.counters.failed).toBe(1);
    expect(outcome.errors[0]?.code).toBe('relation_not_found');

    expect(await findArticle('Good Relation')).toBeDefined();
    expect(await findArticle('Bad Relation')).toBeUndefined();
  });

  it('writes nothing on a dry run', async () => {
    const outcome = await runImport({ csv: 'title\nDry Run Only\n', dryRun: true });

    expect(outcome.counters.created).toBe(1);
    expect(await findArticle('Dry Run Only')).toBeUndefined();
  });

  it('rejects a file whose required column is missing', async () => {
    const outcome = await runImport({ csv: 'body\nNo title here\n' });

    expect(outcome.aborted?.code).toBe('missing_required_columns');
  });

  /**
   * The import service commits a batch inside `strapi.db.transaction` and, when that fails,
   * retries the rows one at a time. That is only safe if the transaction actually rolls back
   * Document Service writes — otherwise the retry would duplicate the rows that already landed.
   */
  it('rolls back Document Service writes when a transaction throws', async () => {
    const before = await articles().count({ filters: { title: 'Rollback Probe' } });

    await expect(
      app.strapi.db.transaction(async () => {
        await articles().create({ data: { title: 'Rollback Probe' } });
        throw new Error('forced rollback');
      })
    ).rejects.toThrow('forced rollback');

    const after = await articles().count({ filters: { title: 'Rollback Probe' } });

    expect(after).toBe(before);
  });
});

describe('export against a real database', () => {
  async function exportToString(): Promise<string> {
    const { PassThrough } = await import('node:stream');
    const sink = new PassThrough();
    const chunks: Buffer[] = [];

    sink.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));

    await app.plugin().service('export').streamTo(
      {
        uid: ARTICLE_UID,
        columns,
        settings: await settings(),
        collection,
        status: 'draft',
      },
      sink
    );

    return Buffer.concat(chunks).toString('utf8');
  }

  it('writes a header row that matches the template', async () => {
    const csv = await exportToString();
    const records = parse(csv, { bom: true, skip_empty_lines: true }) as string[][];

    expect(records[0]).toEqual(columns.map((column) => column.header));
  });

  it('starts with a BOM so Excel reads UTF-8', async () => {
    expect((await exportToString()).startsWith('\uFEFF')).toBe(true);
  });

  it('includes the rows the import created', async () => {
    const csv = await exportToString();

    expect(csv).toContain('Real Import');
    expect(csv).toContain('ada@example.com');
  });

  it('never writes the private field', async () => {
    await articles().create({
      data: { title: 'Has A Secret', internalNote: 'do-not-export-me' },
    });

    expect(await exportToString()).not.toContain('do-not-export-me');
  });
});

describe('export then import is lossless', () => {
  it('re-imports an exported row without changing it', async () => {
    const original = await articles().create({
      data: {
        title: 'Round Trip',
        body: 'Body for the round trip',
        views: 7,
        state: 'live',
        featured: true,
        metadata: { nested: { ok: true } },
        seo: { metaTitle: 'Round trip meta' },
        faq: [{ question: 'Q', answer: 'A' }],
      },
    });

    const { PassThrough } = await import('node:stream');
    const sink = new PassThrough();
    const chunks: Buffer[] = [];
    sink.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));

    await app.plugin().service('export').streamTo(
      {
        uid: ARTICLE_UID,
        columns,
        settings: await settings(),
        collection,
        status: 'draft',
        documentIds: [original.documentId],
      },
      sink
    );

    const csv = Buffer.concat(chunks).toString('utf8');
    const outcome = await runImport({ csv, mode: 'update-only' });

    expect(outcome.aborted).toBeUndefined();
    expect(outcome.errors).toEqual([]);
    expect(outcome.counters.updated).toBe(1);

    const reloaded = await findArticle('Round Trip');

    expect(reloaded.body).toBe('Body for the round trip');
    expect(reloaded.views).toBe(7);
    expect(reloaded.state).toBe('live');
    expect(reloaded.featured).toBe(true);
    expect(reloaded.metadata).toEqual({ nested: { ok: true } });
    expect(reloaded.seo?.metaTitle).toBe('Round trip meta');
    expect((reloaded.faq ?? [])[0]?.question).toBe('Q');
  });
});

describe('template generation against a real schema', () => {
  it('produces a header-only template', async () => {
    const stored = await settings();
    const template = app.plugin().service('template').buildTemplate(ARTICLE_UID, columns, stored);
    const lines = template.content.replace(/^\uFEFF/, '').trim().split(/\r?\n/);

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('createdAt');
  });

  it('produces a guide with one row per column', async () => {
    const stored = await settings();
    const guide = app.plugin().service('template').buildGuide(ARTICLE_UID, columns, stored);
    const lines = guide.content.replace(/^\uFEFF/, '').trim().split(/\r?\n/);

    expect(lines).toHaveLength(columns.length + 1);
  });
});
