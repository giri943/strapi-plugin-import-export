import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import createImportService, { type ImportOutcome } from '../src/services/import';
import { buildColumns } from '../src/core/schema';
import type { ImportMode } from '../src/core/types';
import {
  ARTICLE_UID,
  AUTHOR_UID,
  TAG_UID,
  makeCollectionConfig,
  makeSettings,
  resolver,
} from './fixtures';
import { createFakeStrapi, type FakeStrapiOptions } from './fake-strapi';

let directory: string;
let fileCounter = 0;

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'import-export-import-test-'));
});

afterAll(async () => {
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

async function writeCsv(contents: string): Promise<string> {
  fileCounter += 1;
  const target = path.join(directory, `case-${fileCounter}.csv`);
  await fs.writeFile(target, contents, 'utf8');

  return target;
}

const COLUMNS = buildColumns(resolver, ARTICLE_UID, {
  repeatableColumns: 2,
  relationLookupKeys: { [AUTHOR_UID]: 'email', [TAG_UID]: 'slug' },
});

interface RunOptions {
  csv: string;
  mode?: ImportMode;
  dryRun?: boolean;
  canPublish?: boolean;
  settings?: Partial<ReturnType<typeof makeSettings>>;
  collection?: Partial<ReturnType<typeof makeCollectionConfig>>;
  fake?: FakeStrapiOptions;
}

async function run(options: RunOptions) {
  const fake = createFakeStrapi(options.fake);
  const service = createImportService({ strapi: fake.strapi });
  const filePath = await writeCsv(options.csv);

  const outcome: ImportOutcome = await service.run({
    uid: ARTICLE_UID,
    filePath,
    columns: COLUMNS,
    settings: makeSettings(options.settings),
    collection: makeCollectionConfig(options.collection),
    mode: options.mode ?? 'upsert',
    dryRun: options.dryRun ?? false,
    canPublish: options.canPublish ?? true,
  });

  return { outcome, fake };
}

const codes = (outcome: ImportOutcome) => outcome.errors.map((error) => error.code);

describe('header validation', () => {
  it('reports which columns matched', async () => {
    const { outcome } = await run({ csv: 'title,body\nHello,World\n' });

    expect(outcome.header.recognised).toEqual(['title', 'body']);
    expect(outcome.aborted).toBeUndefined();
  });

  it('names an unknown column and suggests the intended one', async () => {
    const { outcome } = await run({ csv: 'title,Body\nHello,World\n' });

    const unknown = outcome.header.unknownColumns.find((column) => column.header === 'Body');
    expect(unknown?.suggestion).toBe('body');
  });

  it('aborts when no column matches', async () => {
    const { outcome } = await run({ csv: 'nope,also-nope\n1,2\n' });

    expect(outcome.aborted?.code).toBe('no_recognised_columns');
    expect(outcome.counters.totalRows).toBe(0);
  });

  it('aborts when a required column is missing', async () => {
    const { outcome } = await run({ csv: 'body\nWorld\n' });

    expect(outcome.aborted?.code).toBe('missing_required_columns');
    expect(outcome.aborted?.message).toContain('title');
  });

  it('aborts on a duplicated column', async () => {
    const { outcome } = await run({ csv: 'title,title\nA,B\n' });

    expect(outcome.aborted?.code).toBe('duplicate_columns');
  });

  it('ignores read-only columns instead of failing the file', async () => {
    const { outcome, fake } = await run({ csv: 'title,createdAt\nHello,2020-01-01\n' });

    expect(outcome.header.readOnlyIgnored).toContain('createdAt');
    expect(fake.created()[0]?.data?.createdAt).toBeUndefined();
  });

  it('records the identifier column when it is present', async () => {
    const { outcome } = await run({ csv: 'documentId,title\n,Hello\n' });

    expect(outcome.header.identifierColumn).toBe('documentId');
  });

  it('leaves the identifier column unset when the file omits it', async () => {
    const { outcome } = await run({ csv: 'title\nHello\n' });

    expect(outcome.header.identifierColumn).toBeUndefined();
  });

  it('aborts when the file has more columns than allowed', async () => {
    const header = Array.from({ length: 6 }, (_, i) => `c${i}`).join(',');
    const { outcome } = await run({ csv: `${header}\n1,2,3,4,5,6\n`, settings: { maxColumns: 3 } });

    expect(outcome.aborted?.code).toBe('too_many_columns');
  });

  it('refuses a prototype pollution header', async () => {
    const { outcome } = await run({ csv: 'title,__proto__\nHello,boom\n' });

    const unknown = outcome.header.unknownColumns.find((column) => column.header === '__proto__');
    expect(unknown?.reason).toContain('not allowed');
    expect(({} as Record<string, unknown>).boom).toBeUndefined();
  });
});

describe('row limits', () => {
  it('aborts past the row ceiling', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => `Row ${i}`).join('\n');
    const { outcome } = await run({ csv: `title\n${rows}\n`, settings: { maxRows: 3 } });

    expect(outcome.aborted?.code).toBe('too_many_rows');
  });

  it('fails a cell over the length ceiling without failing the file', async () => {
    const long = 'x'.repeat(3000);
    const { outcome } = await run({
      csv: `title,body\nHello,${long}\n`,
      settings: { maxCellLengthKb: 1 },
    });

    expect(codes(outcome)).toContain('cell_too_long');
    expect(outcome.counters.failed).toBe(1);
  });
});

describe('delimiters', () => {
  it('reads a semicolon file even when the setting says comma', async () => {
    const { outcome, fake } = await run({ csv: 'title;body\nHello;World\n' });

    expect(outcome.header.delimiter).toBe(';');
    expect(fake.created()[0]?.data).toMatchObject({ title: 'Hello', body: 'World' });
  });

  it('reads a tab file', async () => {
    const { outcome } = await run({ csv: 'title\tbody\nHello\tWorld\n' });

    expect(outcome.header.delimiter).toBe('\t');
    expect(outcome.counters.created).toBe(1);
  });

  it('sees past a UTF-8 BOM', async () => {
    const { outcome } = await run({ csv: '\uFEFFtitle,body\nHello,World\n' });

    expect(outcome.header.recognised).toEqual(['title', 'body']);
    expect(outcome.counters.created).toBe(1);
  });
});

describe('dry run', () => {
  it('counts what would happen and writes nothing', async () => {
    const { outcome, fake } = await run({
      csv: 'title\nOne\nTwo\n',
      dryRun: true,
    });

    expect(outcome.counters.created).toBe(2);
    expect(fake.writes).toHaveLength(0);
  });

  it('still reports row errors', async () => {
    const { outcome, fake } = await run({
      csv: 'title,views\nOne,not-a-number\n',
      dryRun: true,
    });

    expect(codes(outcome)).toContain('invalid_integer');
    expect(fake.writes).toHaveLength(0);
  });
});

describe('creating and updating', () => {
  it('creates a row with no identifier', async () => {
    const { outcome, fake } = await run({ csv: 'title,views\nHello,5\n' });

    expect(outcome.counters.created).toBe(1);
    expect(fake.created()[0]?.data).toMatchObject({ title: 'Hello', views: 5 });
  });

  it('updates the matching document when the identifier is filled in', async () => {
    const { outcome, fake } = await run({
      csv: 'documentId,title\nexisting-1,Changed\n',
      fake: { documents: { [ARTICLE_UID]: [{ documentId: 'existing-1', title: 'Original' }] } },
    });

    expect(outcome.counters.updated).toBe(1);
    expect(outcome.counters.created).toBe(0);
    expect(fake.updated()[0]).toMatchObject({ documentId: 'existing-1' });
  });

  it('creates when the identifier cell is blank even though the column exists', async () => {
    const { outcome } = await run({
      csv: 'documentId,title\n,Brand new\n',
      fake: { documents: { [ARTICLE_UID]: [{ documentId: 'existing-1', title: 'Original' }] } },
    });

    expect(outcome.counters.created).toBe(1);
  });

  it('clears a field when the column is present and the cell is empty', async () => {
    const { fake } = await run({ csv: 'title,body\nHello,\n' });

    expect(fake.created()[0]?.data).toMatchObject({ title: 'Hello', body: null });
  });

  it('leaves a field untouched when its column is absent from the file', async () => {
    const { fake } = await run({ csv: 'title\nHello\n' });

    expect(Object.keys(fake.created()[0]?.data ?? {})).toEqual(['title']);
  });
});

describe('import modes', () => {
  const existing = { documents: { [ARTICLE_UID]: [{ documentId: 'dup-1', title: 'Original' }] } };

  it('create-only fails a row that already exists', async () => {
    const { outcome } = await run({
      csv: 'documentId,title\ndup-1,Changed\n',
      mode: 'create-only',
      fake: existing,
    });

    expect(codes(outcome)).toContain('duplicate');
    expect(outcome.counters.failed).toBe(1);
  });

  it('update-only fails a row that does not exist', async () => {
    const { outcome } = await run({
      csv: 'documentId,title\nmissing-1,Changed\n',
      mode: 'update-only',
      fake: existing,
    });

    expect(codes(outcome)).toContain('not_found');
  });

  it('skip-duplicates skips quietly without an error', async () => {
    const { outcome, fake } = await run({
      csv: 'documentId,title\ndup-1,Changed\n',
      mode: 'skip-duplicates',
      fake: existing,
    });

    expect(outcome.counters.skipped).toBe(1);
    expect(outcome.counters.failed).toBe(0);
    expect(fake.writes).toHaveLength(0);
  });

  it('upsert updates the existing row and creates the new one', async () => {
    const { outcome } = await run({
      csv: 'documentId,title\ndup-1,Changed\n,Fresh\n',
      mode: 'upsert',
      fake: existing,
    });

    expect(outcome.counters.updated).toBe(1);
    expect(outcome.counters.created).toBe(1);
  });
});

describe('relations', () => {
  const authors = {
    documents: {
      [AUTHOR_UID]: [
        { documentId: 'author-1', email: 'a@b.co' },
        { documentId: 'author-2', email: 'c@d.co' },
      ],
      [TAG_UID]: [
        { documentId: 'tag-1', slug: 'news' },
        { documentId: 'tag-2', slug: 'sport' },
      ],
    },
  };

  it('resolves a single relation to its documentId', async () => {
    const { fake } = await run({
      csv: 'title,author:email\nHello,a@b.co\n',
      fake: authors,
    });

    expect(fake.created()[0]?.data?.author).toBe('author-1');
  });

  it('resolves a many relation to a list of documentIds', async () => {
    const { fake } = await run({
      csv: 'title,tags:slug\nHello,news;sport\n',
      fake: authors,
    });

    expect(fake.created()[0]?.data?.tags).toEqual(['tag-1', 'tag-2']);
  });

  it('fails the row when the related entry does not exist', async () => {
    const { outcome, fake } = await run({
      csv: 'title,author:email\nHello,nobody@nowhere.co\n',
      fake: authors,
    });

    expect(codes(outcome)).toContain('relation_not_found');
    expect(outcome.counters.failed).toBe(1);
    expect(fake.writes).toHaveLength(0);
  });

  it('says what to do about a missing relation', async () => {
    const { outcome } = await run({
      csv: 'title,author:email\nHello,nobody@nowhere.co\n',
      fake: authors,
    });

    expect(outcome.errors[0]?.message).toContain('Create it first');
  });

  it('fails the row when two entries share the lookup value', async () => {
    const { outcome } = await run({
      csv: 'title,author:email\nHello,same@both.co\n',
      fake: {
        documents: {
          [AUTHOR_UID]: [
            { documentId: 'author-1', email: 'same@both.co' },
            { documentId: 'author-2', email: 'same@both.co' },
          ],
        },
      },
    });

    expect(codes(outcome)).toContain('reference_ambiguous');
  });

  it('does not call a missing relation ambiguous when i18n returns one row per locale', async () => {
    const { outcome, fake } = await run({
      csv: 'title,author:email\nHello,a@b.co\n',
      fake: {
        documents: {
          [AUTHOR_UID]: [
            { documentId: 'author-1', email: 'a@b.co' },
            { documentId: 'author-1', email: 'a@b.co' },
          ],
        },
      },
    });

    expect(outcome.counters.failed).toBe(0);
    expect(fake.created()[0]?.data?.author).toBe('author-1');
  });

  it('clears a relation when the cell is empty', async () => {
    const { fake } = await run({
      csv: 'title,author:email,tags:slug\nHello,,\n',
      fake: authors,
    });

    expect(fake.created()[0]?.data?.author).toBeNull();
    expect(fake.created()[0]?.data?.tags).toEqual([]);
  });

  it('rejects several references in a single-valued relation', async () => {
    const { outcome } = await run({
      csv: 'title,author:email\nHello,a@b.co;c@d.co\n',
      fake: authors,
    });

    expect(codes(outcome)).toContain('too_many_references');
  });

  it('resolves a reference whose key contains an escaped delimiter', async () => {
    const { fake } = await run({
      csv: 'title,tags:slug\nHello,"a\\;b"\n',
      fake: { documents: { [TAG_UID]: [{ documentId: 'tag-9', slug: 'a;b' }] } },
    });

    expect(fake.created()[0]?.data?.tags).toEqual(['tag-9']);
  });
});

describe('media', () => {
  const library = { media: [{ id: 7, name: 'hero.webp' }, { id: 8, name: 'other.png' }] };

  it('resolves media by name to the numeric file id', async () => {
    const { fake } = await run({ csv: 'title,cover:name\nHello,hero.webp\n', fake: library });

    expect(fake.created()[0]?.data?.cover).toBe(7);
  });

  it('resolves several media files for a multi-media field', async () => {
    const { fake } = await run({
      csv: 'title,gallery:name\nHello,hero.webp;other.png\n',
      fake: library,
    });

    expect(fake.created()[0]?.data?.gallery).toEqual([7, 8]);
  });

  it('fails the row when the file is not in the library', async () => {
    const { outcome } = await run({ csv: 'title,cover:name\nHello,missing.png\n', fake: library });

    expect(codes(outcome)).toContain('media_not_found');
  });

  it('fails the row when two files share a name', async () => {
    const { outcome } = await run({
      csv: 'title,cover:name\nHello,same.png\n',
      fake: { media: [{ id: 1, name: 'same.png' }, { id: 2, name: 'same.png' }] },
    });

    expect(codes(outcome)).toContain('reference_ambiguous');
  });
});

describe('components', () => {
  it('assembles a single component from its dotted columns', async () => {
    const { fake } = await run({
      csv: 'title,seo.metaTitle,seo.metaDescription\nHello,Meta,Desc\n',
    });

    expect(fake.created()[0]?.data?.seo).toMatchObject({
      metaTitle: 'Meta',
      metaDescription: 'Desc',
    });
  });

  it('assembles a repeatable component from its indexed columns', async () => {
    const { fake } = await run({
      csv: 'title,faq[0].question,faq[0].answer,faq[1].question,faq[1].answer\nHello,Q1,A1,Q2,A2\n',
    });

    expect(fake.created()[0]?.data?.faq).toEqual([
      { question: 'Q1', answer: 'A1' },
      { question: 'Q2', answer: 'A2' },
    ]);
  });

  it('drops a repeatable slot the operator left entirely blank', async () => {
    const { fake } = await run({
      csv: 'title,faq[0].question,faq[0].answer,faq[1].question,faq[1].answer\nHello,Q1,A1,,\n',
    });

    expect(fake.created()[0]?.data?.faq).toEqual([{ question: 'Q1', answer: 'A1' }]);
  });

  it('closes the gap when a middle slot is blank', async () => {
    const { fake } = await run({
      csv: 'title,faq[0].question,faq[1].question\nHello,,Q2\n',
    });

    expect(fake.created()[0]?.data?.faq).toEqual([{ question: 'Q2' }]);
  });
});

describe('dynamic zones', () => {
  it('accepts a JSON array naming allowed components', async () => {
    const zone = JSON.stringify([{ __component: 'blocks.hero', heading: 'Hi' }]);
    const { outcome, fake } = await run({
      csv: `title,sections\nHello,"${zone.replace(/"/g, '""')}"\n`,
    });

    expect(outcome.counters.failed).toBe(0);
    expect(fake.created()[0]?.data?.sections).toEqual([
      { __component: 'blocks.hero', heading: 'Hi' },
    ]);
  });

  it('rejects an entry with no __component key', async () => {
    const zone = JSON.stringify([{ heading: 'Hi' }]);
    const { outcome } = await run({
      csv: `title,sections\nHello,"${zone.replace(/"/g, '""')}"\n`,
    });

    expect(codes(outcome)).toContain('missing_component');
  });

  it('rejects a component the zone does not allow', async () => {
    const zone = JSON.stringify([{ __component: 'blocks.nope' }]);
    const { outcome } = await run({
      csv: `title,sections\nHello,"${zone.replace(/"/g, '""')}"\n`,
    });

    expect(codes(outcome)).toContain('component_not_allowed');
    expect(outcome.errors[0]?.message).toContain('blocks.hero');
  });

  it('rejects an object where an array is required', async () => {
    const { outcome } = await run({ csv: 'title,sections\nHello,"{""a"":1}"\n' });

    expect(codes(outcome)).toContain('invalid_dynamiczone');
  });

  it('rejects malformed JSON', async () => {
    const { outcome } = await run({ csv: 'title,sections\nHello,"{nope}"\n' });

    expect(codes(outcome)).toContain('invalid_json');
  });

  it('treats a blank cell as an empty zone', async () => {
    const { fake } = await run({ csv: 'title,sections\nHello,\n' });

    expect(fake.created()[0]?.data?.sections).toEqual([]);
  });
});

describe('draft and publish', () => {
  it('creates a published entry in one call when status says published', async () => {
    const { fake } = await run({ csv: 'title,status\nHello,published\n' });

    expect(fake.created()[0]?.status).toBe('published');
  });

  it('creates a draft when status says draft', async () => {
    const { fake } = await run({ csv: 'title,status\nHello,draft\n' });

    expect(fake.created()[0]?.status).toBeUndefined();
  });

  it('publishes separately after an update, because update takes no status', async () => {
    const { fake } = await run({
      csv: 'documentId,title,status\nexisting-1,Changed,published\n',
      fake: { documents: { [ARTICLE_UID]: [{ documentId: 'existing-1', title: 'Original' }] } },
    });

    expect(fake.updated()).toHaveLength(1);
    expect(fake.published()).toHaveLength(1);
  });

  it('never unpublishes an existing entry when a row says draft', async () => {
    const { fake } = await run({
      csv: 'documentId,title,status\nexisting-1,Changed,draft\n',
      fake: { documents: { [ARTICLE_UID]: [{ documentId: 'existing-1', title: 'Original' }] } },
    });

    expect(fake.published()).toHaveLength(0);
    expect(fake.writes.some((write) => write.kind === 'update')).toBe(true);
  });

  it('rejects an unknown status value', async () => {
    const { outcome } = await run({ csv: 'title,status\nHello,live\n' });

    expect(codes(outcome)).toContain('invalid_status');
  });

  it('fails only the publishing rows when the user cannot publish', async () => {
    const { outcome, fake } = await run({
      csv: 'title,status\nOne,published\nTwo,draft\n',
      canPublish: false,
    });

    expect(codes(outcome)).toContain('publish_not_allowed');
    expect(outcome.counters.failed).toBe(1);
    expect(outcome.counters.created).toBe(1);
    expect(fake.created()[0]?.data?.title).toBe('Two');
  });
});

describe('value validation', () => {
  it('fails a row with a bad enum and names the options', async () => {
    const { outcome } = await run({ csv: 'title,state\nHello,nope\n' });

    expect(codes(outcome)).toContain('invalid_enum');
    expect(outcome.errors[0]?.message).toContain('draft, review, live');
  });

  it('attributes the error to the offending column and line', async () => {
    const { outcome } = await run({ csv: 'title,views\nOne,5\nTwo,bad\n' });

    expect(outcome.errors[0]).toMatchObject({ line: 3, column: 'views', code: 'invalid_integer' });
  });

  it('keeps the good rows when one row fails', async () => {
    const { outcome, fake } = await run({ csv: 'title,views\nOne,5\nTwo,bad\nThree,7\n' });

    expect(outcome.counters.created).toBe(2);
    expect(outcome.counters.failed).toBe(1);
    expect(fake.created().map((write) => write.data?.title)).toEqual(['One', 'Three']);
  });

  it('fails a row missing a required value', async () => {
    const { outcome } = await run({ csv: 'title,body\n,World\n' });

    expect(codes(outcome)).toContain('required');
  });

  it('strips the apostrophe an export added to neutralise a formula', async () => {
    const { fake } = await run({ csv: "title\n'=1+1\n" });

    expect(fake.created()[0]?.data?.title).toBe('=1+1');
  });
});

describe('batching', () => {
  it('commits in batches of the configured size', async () => {
    const rows = Array.from({ length: 7 }, (_, i) => `Row ${i}`).join('\n');
    const { outcome } = await run({ csv: `title\n${rows}\n`, settings: { batchSize: 2 } });

    expect(outcome.counters.created).toBe(7);
    expect(outcome.counters.totalRows).toBe(7);
  });

  it('reports progress as batches complete', async () => {
    const fake = createFakeStrapi();
    const service = createImportService({ strapi: fake.strapi });
    const filePath = await writeCsv(`title\n${['A', 'B', 'C', 'D'].join('\n')}\n`);
    const snapshots: number[] = [];

    await service.run({
      uid: ARTICLE_UID,
      filePath,
      columns: COLUMNS,
      settings: makeSettings({ batchSize: 2 }),
      collection: makeCollectionConfig(),
      mode: 'upsert',
      dryRun: false,
      canPublish: true,
      onProgress: async (counters) => {
        snapshots.push(counters.processedRows);
      },
    });

    expect(snapshots).toEqual([2, 4]);
  });

  it('isolates the offending row when the database rejects a batch', async () => {
    const { outcome, fake } = await run({
      csv: 'title\nGood one\nPoison\nGood two\n',
      settings: { batchSize: 10 },
      fake: { rejectTitles: ['Poison'] },
    });

    expect(outcome.counters.created).toBe(2);
    expect(outcome.counters.failed).toBe(1);
    expect(codes(outcome)).toContain('write_failed');
    expect(fake.store[ARTICLE_UID].map((row) => row.title)).toEqual(['Good one', 'Good two']);
  });

  it('retries row by row when the whole transaction aborts', async () => {
    const { outcome } = await run({
      csv: 'title\nOne\nTwo\n',
      settings: { batchSize: 10 },
      fake: { failBatchedTransactions: true },
    });

    // Every row is retried individually and each retry also aborts, so all of them are reported
    // rather than the run dying on the first failure.
    expect(outcome.counters.failed).toBe(2);
    expect(codes(outcome)).toEqual(['write_failed', 'write_failed']);
  });
});

describe('locale', () => {
  it('passes the locale column through to the write', async () => {
    const { fake } = await run({ csv: 'title,locale\nHello,fr\n' });

    expect(fake.created()[0]?.locale).toBe('fr');
  });
});
