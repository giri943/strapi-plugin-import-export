import { describe, expect, it } from 'vitest';
import {
  MAX_FILTER_VALUES,
  MAX_RELATION_FILTERS,
  buildFilters,
  parseExportFilters,
  relationFilterFields,
} from '../src/core/export-filters';
import { buildColumns } from '../src/core/schema';
import { ARTICLE_UID, resolver } from './fixtures';

const columns = buildColumns(resolver, ARTICLE_UID, { repeatableColumns: 1 });
const opts = { hasDraftAndPublish: true };

const parse = (input: Record<string, unknown>) => parseExportFilters(columns, input, opts);

const ok = (input: Record<string, unknown>) => {
  const result = parse(input);
  if (!result.ok) throw new Error(`expected success, got ${result.code}: ${result.message}`);
  return result;
};

const fail = (input: Record<string, unknown>) => {
  const result = parse(input);
  if (result.ok) throw new Error('expected a rejection');
  return result;
};

describe('relationFilterFields', () => {
  it('lists top-level relations', () => {
    const fields = relationFilterFields(columns);

    expect([...fields].sort()).toEqual(['author', 'tags']);
  });

  it('excludes the read-only label copies', () => {
    // Both author:documentId and author:name exist; only the field name should appear once.
    expect([...relationFilterFields(columns)].filter((f) => f === 'author')).toHaveLength(1);
  });

  it('excludes media, components and dynamic zones', () => {
    const fields = relationFilterFields(columns);

    expect(fields.has('cover')).toBe(false);
    expect(fields.has('gallery')).toBe(false);
    expect(fields.has('seo')).toBe(false);
    expect(fields.has('sections')).toBe(false);
  });
});

describe('relation filters', () => {
  it('accepts a field with values', () => {
    const result = ok({ relationFilters: [{ field: 'author', documentIds: ['a1', 'a2'] }] });

    expect(result.relations).toEqual([{ field: 'author', documentIds: ['a1', 'a2'] }]);
  });

  it('accepts several fields at once', () => {
    const result = ok({
      relationFilters: [
        { field: 'author', documentIds: ['a1'] },
        { field: 'tags', documentIds: ['t1', 't2'] },
      ],
    });

    expect(result.relations).toHaveLength(2);
  });

  it('removes duplicate values', () => {
    const result = ok({ relationFilters: [{ field: 'author', documentIds: ['a1', 'a1'] }] });

    expect(result.relations[0]?.documentIds).toEqual(['a1']);
  });

  it('drops a field with no values rather than matching nothing', () => {
    const result = ok({ relationFilters: [{ field: 'author', documentIds: [] }] });

    expect(result.relations).toEqual([]);
  });

  it('refuses a field that is not a relation on this collection', () => {
    expect(fail({ relationFilters: [{ field: 'title', documentIds: ['x'] }] }).code).toBe(
      'field_not_filterable'
    );
  });

  it('refuses a media field', () => {
    expect(fail({ relationFilters: [{ field: 'cover', documentIds: ['x'] }] }).code).toBe(
      'field_not_filterable'
    );
  });

  it('refuses a field that does not exist at all', () => {
    expect(fail({ relationFilters: [{ field: 'nope', documentIds: ['x'] }] }).code).toBe(
      'field_not_filterable'
    );
  });

  it('refuses the same field twice', () => {
    expect(
      fail({
        relationFilters: [
          { field: 'author', documentIds: ['a1'] },
          { field: 'author', documentIds: ['a2'] },
        ],
      }).code
    ).toBe('duplicate_filter_field');
  });

  it('refuses a missing field name', () => {
    expect(fail({ relationFilters: [{ documentIds: ['a1'] }] }).code).toBe('missing_filter_field');
  });

  it('refuses values that are not an array', () => {
    expect(fail({ relationFilters: [{ field: 'author', documentIds: 'a1' }] }).code).toBe(
      'missing_filter_values'
    );
  });

  it('refuses more filters than the limit', () => {
    const many = Array.from({ length: MAX_RELATION_FILTERS + 1 }, () => ({
      field: 'author',
      documentIds: ['a'],
    }));

    expect(fail({ relationFilters: many }).code).toBe('too_many_relation_filters');
  });

  it('refuses more values than the limit', () => {
    const values = Array.from({ length: MAX_FILTER_VALUES + 1 }, (_, i) => `id-${i}`);

    expect(fail({ relationFilters: [{ field: 'author', documentIds: values }] }).code).toBe(
      'too_many_filter_values'
    );
  });

  it('refuses a payload that is not an array', () => {
    expect(fail({ relationFilters: { field: 'author' } }).code).toBe('invalid_relation_filters');
  });

  /**
   * The payload is a field name plus ids on purpose. Accepting a Strapi filter object would let a
   * caller query any joined column, including ones the plugin never exposes.
   */
  it('ignores a raw Strapi filter object smuggled in alongside', () => {
    const result = ok({
      filters: { internalSecret: { $containsi: 'leak' } },
      relationFilters: [{ field: 'author', documentIds: ['a1'] }],
    });

    const built = buildFilters({ relations: result.relations, dates: result.dates });

    expect(JSON.stringify(built)).not.toContain('internalSecret');
    expect(Object.keys(built ?? {})).toEqual(['author']);
  });
});

describe('date filters', () => {
  it('accepts a from and to range', () => {
    const result = ok({ dateFilters: [{ field: 'createdAt', from: '2026-01-01', to: '2026-01-31' }] });

    expect(result.dates[0]?.from).toBe('2026-01-01T00:00:00.000Z');
    // A "to" date has to cover the whole day, not stop at its first instant.
    expect(result.dates[0]?.to).toBe('2026-01-31T23:59:59.999Z');
  });

  it('accepts a full ISO timestamp unchanged in meaning', () => {
    const result = ok({ dateFilters: [{ field: 'updatedAt', from: '2026-01-01T09:30:00Z' }] });

    expect(result.dates[0]?.from).toBe('2026-01-01T09:30:00.000Z');
  });

  it('accepts an open-ended range', () => {
    expect(ok({ dateFilters: [{ field: 'createdAt', from: '2026-01-01' }] }).dates[0]?.to).toBeUndefined();
    expect(ok({ dateFilters: [{ field: 'createdAt', to: '2026-01-01' }] }).dates[0]?.from).toBeUndefined();
  });

  it('drops a range with neither end set', () => {
    expect(ok({ dateFilters: [{ field: 'createdAt' }] }).dates).toEqual([]);
  });

  it('allows publishedAt only when draft and publish is on', () => {
    expect(ok({ dateFilters: [{ field: 'publishedAt', from: '2026-01-01' }] }).dates).toHaveLength(1);

    const without = parseExportFilters(columns, { dateFilters: [{ field: 'publishedAt', from: '2026-01-01' }] }, {
      hasDraftAndPublish: false,
    });

    expect(without.ok).toBe(false);
  });

  it('refuses an arbitrary field', () => {
    expect(fail({ dateFilters: [{ field: 'title', from: '2026-01-01' }] }).code).toBe(
      'field_not_filterable'
    );
  });

  it('refuses an unparseable date', () => {
    expect(fail({ dateFilters: [{ field: 'createdAt', from: 'last tuesday' }] }).code).toBe(
      'invalid_date'
    );
  });

  it('refuses a reversed range', () => {
    expect(
      fail({ dateFilters: [{ field: 'createdAt', from: '2026-02-01', to: '2026-01-01' }] }).code
    ).toBe('date_range_reversed');
  });
});

describe('buildFilters', () => {
  it('returns undefined with nothing to filter', () => {
    expect(buildFilters({ relations: [], dates: [] })).toBeUndefined();
  });

  it('matches any of the values within a field', () => {
    const built = buildFilters({
      relations: [{ field: 'category', documentIds: ['c1', 'c2'] }],
      dates: [],
    });

    expect(built).toEqual({ category: { documentId: { $in: ['c1', 'c2'] } } });
  });

  it('combines several fields', () => {
    const built = buildFilters({
      relations: [
        { field: 'author', documentIds: ['a1'] },
        { field: 'tags', documentIds: ['t1'] },
      ],
      dates: [],
    });

    expect(Object.keys(built ?? {}).sort()).toEqual(['author', 'tags']);
  });

  it('adds date bounds', () => {
    const built = buildFilters({
      relations: [],
      dates: [{ field: 'createdAt', from: '2026-01-01T00:00:00.000Z', to: '2026-01-31T23:59:59.999Z' }],
    });

    expect(built).toEqual({
      createdAt: { $gte: '2026-01-01T00:00:00.000Z', $lte: '2026-01-31T23:59:59.999Z' },
    });
  });

  it('keeps an explicit documentId selection alongside the filters', () => {
    const built = buildFilters({
      relations: [{ field: 'author', documentIds: ['a1'] }],
      dates: [],
      documentIds: ['d1', 'd2'],
    });

    expect(built?.documentId).toEqual({ $in: ['d1', 'd2'] });
    expect(built?.author).toBeDefined();
  });
});
