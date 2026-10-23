import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PassThrough } from 'node:stream';
import { buildColumns } from '../../src/core/schema';
import { selectColumns } from '../../src/core/select-columns';
import { parseExportFilters } from '../../src/core/export-filters';
import { createSchemaResolver } from '../../src/utils/strapi-schema';
import type { ColumnDescriptor } from '../../src/core/types';
import { ARTICLE_UID, bootStrapi, type BootedStrapi } from './boot';

const CATEGORY_UID = 'api::category.category';

let app: BootedStrapi;
let columns: ColumnDescriptor[];
let newsId = '';
let sportId = '';
let duplicateA = '';
let duplicateB = '';

const collection = {
  enabled: true,
  allowImport: true,
  allowExport: true,
  excludeFields: [] as string[],
  relationLookupKeys: {},
  relationLabelKeys: {},
  identifierField: 'documentId',
};

const settings = () => app.plugin().service('settings').get();

async function exportCsv(body: Record<string, unknown> = {}): Promise<string> {
  const stored = await settings();
  const parsed = parseExportFilters(columns, body, { hasDraftAndPublish: true });
  if (!parsed.ok) throw new Error(`filter rejected: ${parsed.code} ${parsed.message}`);

  const selection = selectColumns(columns, body.columns as string[] | undefined);

  const sink = new PassThrough();
  const chunks: Buffer[] = [];
  sink.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));

  await app.plugin().service('export').streamTo(
    {
      uid: ARTICLE_UID,
      columns: selection.columns,
      settings: stored,
      collection,
      status: 'draft',
      relationFilters: parsed.relations,
      dateFilters: parsed.dates,
    },
    sink
  );

  return Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/, '');
}

const rowsOf = (csv: string) => csv.trim().split(/\r?\n/).slice(1);
const headerOf = (csv: string) => csv.trim().split(/\r?\n/)[0]?.split(',') ?? [];

beforeAll(async () => {
  app = await bootStrapi();

  columns = buildColumns(createSchemaResolver(app.strapi), ARTICLE_UID, {
    repeatableColumns: 1,
  });

  const categories = app.strapi.documents(CATEGORY_UID);
  const news = await categories.create({ data: { name: 'News', slug: 'news' } });
  const sport = await categories.create({ data: { name: 'Sport', slug: 'sport' } });

  // Two categories deliberately share a name. `name` is not unique in the schema, which is the
  // normal Strapi default and the reason the label column is separate from the match column.
  const dupA = await categories.create({ data: { name: 'Shared', slug: 'shared-a' } });
  const dupB = await categories.create({ data: { name: 'Shared', slug: 'shared-b' } });

  newsId = news.documentId;
  sportId = sport.documentId;
  duplicateA = dupA.documentId;
  duplicateB = dupB.documentId;

  const articles = app.strapi.documents(ARTICLE_UID);
  await articles.create({ data: { title: 'News one', category: newsId } });
  await articles.create({ data: { title: 'News two', category: newsId } });
  await articles.create({ data: { title: 'Sport one', category: sportId } });
  await articles.create({ data: { title: 'Uncategorised' } });
  await articles.create({ data: { title: 'Shared one', category: duplicateA } });
});

afterAll(async () => {
  if (app) await app.stop();
});

describe('label columns against a real schema', () => {
  it('generates both an id column and a name column for category', () => {
    const headers = columns.map((column) => column.header);

    expect(headers).toContain('category:documentId');
    expect(headers).toContain('category:name');
  });

  it('marks the name column read-only', () => {
    const label = columns.find((column) => column.header === 'category:name');

    expect(label?.readOnly).toBe(true);
    expect(label?.isLabel).toBe(true);
  });

  it('writes the readable name, not just the id', async () => {
    const csv = await exportCsv();
    const header = headerOf(csv);
    const nameIndex = header.indexOf('category:name');
    const idIndex = header.indexOf('category:documentId');

    expect(nameIndex).toBeGreaterThan(-1);

    const newsRow = rowsOf(csv).find((row) => row.startsWith('"') === false && row.includes('News one'));
    expect(newsRow).toBeDefined();

    const cells = (newsRow as string).split(',');
    expect(cells[nameIndex]).toBe('News');
    expect(cells[idIndex]).toBe(newsId);
  });
});

describe('filtering an export by category', () => {
  it('returns every row with no filter', async () => {
    expect(rowsOf(await exportCsv())).toHaveLength(5);
  });

  it('returns only the rows in one category', async () => {
    const csv = await exportCsv({
      relationFilters: [{ field: 'category', documentIds: [newsId] }],
    });

    const rows = rowsOf(csv);
    expect(rows).toHaveLength(2);
    expect(csv).toContain('News one');
    expect(csv).toContain('News two');
    expect(csv).not.toContain('Sport one');
    expect(csv).not.toContain('Uncategorised');
  });

  it('treats several values in one field as "any of"', async () => {
    const csv = await exportCsv({
      relationFilters: [{ field: 'category', documentIds: [newsId, sportId] }],
    });

    expect(rowsOf(csv)).toHaveLength(3);
    expect(csv).toContain('Sport one');
  });

  it('excludes rows with no category at all', async () => {
    const csv = await exportCsv({
      relationFilters: [{ field: 'category', documentIds: [newsId, sportId, duplicateA, duplicateB] }],
    });

    expect(csv).not.toContain('Uncategorised');
  });

  it('distinguishes two categories that share a name', async () => {
    const onlyA = await exportCsv({
      relationFilters: [{ field: 'category', documentIds: [duplicateA] }],
    });
    const onlyB = await exportCsv({
      relationFilters: [{ field: 'category', documentIds: [duplicateB] }],
    });

    expect(rowsOf(onlyA)).toHaveLength(1);
    expect(onlyA).toContain('Shared one');
    // Filtering is by id, so the duplicate name does not blur the two categories together.
    expect(rowsOf(onlyB)).toHaveLength(0);
  });

  it('returns an empty file body for a category with no rows', async () => {
    const csv = await exportCsv({
      relationFilters: [{ field: 'category', documentIds: [duplicateB] }],
    });

    expect(rowsOf(csv)).toHaveLength(0);
    expect(headerOf(csv).length).toBeGreaterThan(0);
  });

  it('filters on a date range', async () => {
    const today = new Date().toISOString().slice(0, 10);

    const inRange = await exportCsv({ dateFilters: [{ field: 'createdAt', from: today, to: today }] });
    expect(rowsOf(inRange)).toHaveLength(5);

    const before = await exportCsv({
      dateFilters: [{ field: 'createdAt', to: '2020-01-01' }],
    });
    expect(rowsOf(before)).toHaveLength(0);
  });

  it('combines a relation filter and a date range', async () => {
    const today = new Date().toISOString().slice(0, 10);

    const csv = await exportCsv({
      relationFilters: [{ field: 'category', documentIds: [newsId] }],
      dateFilters: [{ field: 'createdAt', from: today }],
    });

    expect(rowsOf(csv)).toHaveLength(2);
  });

  it('refuses a field that is not a filterable relation', async () => {
    await expect(
      exportCsv({ relationFilters: [{ field: 'title', documentIds: ['x'] }] })
    ).rejects.toThrow(/field_not_filterable/);
  });
});

describe('choosing which columns to export', () => {
  it('writes only the chosen columns, in schema order', async () => {
    const csv = await exportCsv({ columns: ['title', 'documentId', 'category:name'] });

    expect(headerOf(csv)).toEqual(['documentId', 'title', 'category:name']);
  });

  it('still writes a row per entry', async () => {
    const csv = await exportCsv({ columns: ['title'] });

    expect(headerOf(csv)).toEqual(['title']);
    expect(rowsOf(csv)).toHaveLength(5);
  });

  it('ignores a header that is not on offer', async () => {
    const csv = await exportCsv({ columns: ['title', 'internalNote', 'nonsense'] });

    expect(headerOf(csv)).toEqual(['title']);
  });

  it('combines a column subset with a category filter', async () => {
    const csv = await exportCsv({
      columns: ['title', 'category:name'],
      relationFilters: [{ field: 'category', documentIds: [newsId] }],
    });

    expect(headerOf(csv)).toEqual(['title', 'category:name']);
    expect(rowsOf(csv)).toHaveLength(2);
    expect(csv).toContain('News');
  });
});

describe('relation options for the filter dropdown', () => {
  it('lists the categories with their readable labels', async () => {
    const stored = await settings();
    const resolved = app
      .plugin()
      .service('schema')
      .describeRelationField(ARTICLE_UID, 'category', stored, collection);

    expect(resolved?.targetUid).toBe(CATEGORY_UID);
    expect(resolved?.labelKey).toBe('name');

    const result = await app.plugin().service('export').listRelationOptions({
      targetUid: CATEGORY_UID,
      labelKey: 'name',
      search: '',
      page: 1,
      pageSize: 50,
    });

    expect(result.total).toBe(4);
    expect(result.options.map((option: { label: string }) => option.label).sort()).toEqual([
      'News',
      'Shared',
      'Shared',
      'Sport',
    ]);
  });

  it('searches by the label', async () => {
    const result = await app.plugin().service('export').listRelationOptions({
      targetUid: CATEGORY_UID,
      labelKey: 'name',
      search: 'spo',
      page: 1,
      pageSize: 50,
    });

    expect(result.options).toHaveLength(1);
    expect(result.options[0]?.label).toBe('Sport');
  });

  it('returns a distinct id for each duplicate name, so they stay pickable apart', async () => {
    const result = await app.plugin().service('export').listRelationOptions({
      targetUid: CATEGORY_UID,
      labelKey: 'name',
      search: 'Shared',
      page: 1,
      pageSize: 50,
    });

    const ids = result.options.map((option: { documentId: string }) => option.documentId);

    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
  });

  it('refuses a field that is not a relation', async () => {
    const stored = await settings();
    const resolved = app
      .plugin()
      .service('schema')
      .describeRelationField(ARTICLE_UID, 'title', stored, collection);

    expect(resolved).toBeUndefined();
  });
});
