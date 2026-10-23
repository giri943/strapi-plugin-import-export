import { describe, expect, it } from 'vitest';
import {
  buildColumns,
  isUsableLookupKey,
  listUsableLookupKeys,
  isSensitiveAttribute,
} from '../src/core/schema';
import { formatHeader, parseHeader } from '../src/core/columns';
import { ARTICLE_UID, AUTHOR_UID, TAG_UID, articleSchema, resolver } from './fixtures';

const columnsFor = (options = {}) => buildColumns(resolver, ARTICLE_UID, options);
const headers = (options = {}) => columnsFor(options).map((column) => column.header);

describe('buildColumns', () => {
  it('puts documentId first so a template reads as identifier then data', () => {
    expect(headers()[0]).toBe('documentId');
  });

  it('adds locale and status only for a localized draft-and-publish collection', () => {
    const list = headers();
    expect(list).toContain('locale');
    expect(list).toContain('status');

    const plain = buildColumns(
      {
        getContentType: () => ({ ...articleSchema, options: {}, pluginOptions: {} }),
        getComponent: resolver.getComponent,
      },
      ARTICLE_UID
    ).map((column) => column.header);

    expect(plain).not.toContain('locale');
    expect(plain).not.toContain('status');
  });

  it('emits one column per scalar', () => {
    expect(headers()).toEqual(expect.arrayContaining(['title', 'slug', 'body', 'views', 'state']));
  });

  it('flattens a single component with a dotted path', () => {
    expect(headers()).toEqual(
      expect.arrayContaining(['seo.metaTitle', 'seo.metaDescription', 'seo.shareImage:name'])
    );
  });

  it('gives a repeatable component one indexed set of columns per slot', () => {
    const list = headers({ repeatableColumns: 2 });

    expect(list).toContain('faq[0].question');
    expect(list).toContain('faq[0].answer');
    expect(list).toContain('faq[1].question');
    expect(list).not.toContain('faq[2].question');
  });

  it('respects the repeatable slot count', () => {
    expect(headers({ repeatableColumns: 1 }).filter((h) => h.startsWith('faq['))).toHaveLength(2);
    expect(headers({ repeatableColumns: 4 }).filter((h) => h.startsWith('faq['))).toHaveLength(8);
  });

  it('gives a dynamic zone a single JSON column', () => {
    const zone = columnsFor().find((column) => column.header === 'sections');

    expect(zone).toBeDefined();
    expect(zone?.kind).toBe('dynamiczone');
    expect(zone?.hint).toContain('__component');
    expect(zone?.hint).toContain('blocks.hero');
  });

  it('names relations with their lookup key and defaults to documentId', () => {
    const author = columnsFor().find((column) => column.header.startsWith('author'));

    expect(author?.header).toBe('author:documentId');
    expect(author?.kind).toBe('relation');
    expect(author?.multiple).toBe(false);
    expect(author?.targetUid).toBe(AUTHOR_UID);
  });

  it('uses a configured lookup key when the target allows it', () => {
    const list = headers({ relationLookupKeys: { [AUTHOR_UID]: 'email', [TAG_UID]: 'slug' } });

    expect(list).toContain('author:email');
    expect(list).toContain('tags:slug');
  });

  it('ignores a configured lookup key that cannot identify one entry', () => {
    const list = headers({ relationLookupKeys: { [AUTHOR_UID]: 'bio' } });

    expect(list).toContain('author:documentId');
    expect(list).not.toContain('author:bio');
  });

  it('marks a many relation as multiple', () => {
    const tags = columnsFor().find((column) => column.header.startsWith('tags'));

    expect(tags?.multiple).toBe(true);
  });

  it('names media with the configured key and flags multi-media', () => {
    const list = columnsFor({ mediaLookupKey: 'url' });

    expect(list.find((c) => c.header === 'cover:url')?.multiple).toBe(false);
    expect(list.find((c) => c.header === 'gallery:url')?.multiple).toBe(true);
  });

  it('never exposes private or password fields', () => {
    const list = headers();

    expect(list).not.toContain('internalSecret');
    expect(list).not.toContain('password');
    // Also not through a component path.
    expect(list).not.toContain('seo.internalNote');
  });

  it('skips polymorphic relations and relations with no target', () => {
    const list = headers();

    expect(list.some((header) => header.startsWith('related'))).toBe(false);
    expect(list.some((header) => header.startsWith('orphan'))).toBe(false);
  });

  it('skips Strapi bookkeeping relations', () => {
    const list = headers();

    for (const header of list) {
      expect(header.startsWith('createdBy')).toBe(false);
      expect(header.startsWith('updatedBy')).toBe(false);
      expect(header.startsWith('localizations')).toBe(false);
    }
  });

  it('offers timestamps as read-only columns', () => {
    const list = columnsFor();
    const createdAt = list.find((column) => column.header === 'createdAt');
    const publishedAt = list.find((column) => column.header === 'publishedAt');

    expect(createdAt?.readOnly).toBe(true);
    expect(publishedAt?.readOnly).toBe(true);
  });

  it('honours an administrator field exclusion', () => {
    const list = headers({ excludeFields: ['body', 'tags'] });

    expect(list).not.toContain('body');
    expect(list.some((header) => header.startsWith('tags'))).toBe(false);
    expect(list).toContain('title');
  });

  it('excludes a field nested in a component by its dotted path', () => {
    const list = headers({ excludeFields: ['seo.metaDescription'] });

    expect(list).not.toContain('seo.metaDescription');
    expect(list).toContain('seo.metaTitle');
  });

  it('returns nothing for an unknown content type', () => {
    expect(buildColumns(resolver, 'api::nope.nope')).toEqual([]);
  });

  it('marks a required scalar as required', () => {
    expect(columnsFor().find((column) => column.header === 'title')?.required).toBe(true);
    expect(columnsFor().find((column) => column.header === 'body')?.required).toBe(false);
  });

  it('produces only headers that parse back to themselves', () => {
    for (const header of headers()) {
      const parsed = parseHeader(header);
      expect(parsed.ok, `${header} should parse`).toBe(true);
      if (parsed.ok) expect(formatHeader(parsed.value)).toBe(header);
    }
  });

  it('produces no duplicate headers', () => {
    const list = headers();
    expect(new Set(list).size).toBe(list.length);
  });

  it('stops component recursion at the depth limit', () => {
    const deep = headers({ maxDepth: 1 });

    expect(deep.some((header) => header.startsWith('seo.'))).toBe(false);
    expect(deep).toContain('title');
  });
});

describe('lookup keys', () => {
  it('always accepts documentId', () => {
    expect(isUsableLookupKey(articleSchema, 'documentId')).toBe(true);
  });

  it('accepts a uid field and a unique field', () => {
    expect(isUsableLookupKey(articleSchema, 'slug')).toBe(true);
    const author = resolver.getContentType(AUTHOR_UID)!;
    expect(isUsableLookupKey(author, 'email')).toBe(true);
  });

  it('rejects a non-unique field', () => {
    expect(isUsableLookupKey(articleSchema, 'title')).toBe(false);
    expect(isUsableLookupKey(articleSchema, 'body')).toBe(false);
  });

  it('rejects an unknown field and a private one', () => {
    expect(isUsableLookupKey(articleSchema, 'nope')).toBe(false);
    expect(isUsableLookupKey(articleSchema, 'internalSecret')).toBe(false);
  });

  it('lists documentId plus the usable keys', () => {
    expect(listUsableLookupKeys(articleSchema)).toEqual(['documentId', 'slug']);
  });
});

describe('isSensitiveAttribute', () => {
  it('catches private fields and password fields', () => {
    expect(isSensitiveAttribute({ type: 'string', private: true })).toBe(true);
    expect(isSensitiveAttribute({ type: 'password' })).toBe(true);
    expect(isSensitiveAttribute({ type: 'string' })).toBe(false);
  });
});
