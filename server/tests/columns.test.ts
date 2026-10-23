import { describe, expect, it } from 'vitest';
import {
  MAX_PATH_DEPTH,
  MAX_REPEATABLE_INDEX,
  escapeMultiValue,
  formatHeader,
  joinMultiValue,
  normaliseHeader,
  parseHeader,
  splitMultiValue,
  suggestColumn,
  withIndex,
} from '../src/core/columns';

const ok = (header: string) => {
  const result = parseHeader(header);
  if (!result.ok) throw new Error(`expected "${header}" to parse, got ${result.code}`);
  return result.value;
};

const fail = (header: string) => {
  const result = parseHeader(header);
  if (result.ok) throw new Error(`expected "${header}" to be rejected`);
  return result;
};

describe('parseHeader', () => {
  it('reads a plain scalar column', () => {
    expect(ok('title')).toEqual({ path: [{ field: 'title' }] });
  });

  it('reads a single component path', () => {
    expect(ok('seo.metaTitle')).toEqual({
      path: [{ field: 'seo' }, { field: 'metaTitle' }],
    });
  });

  it('reads a repeatable component slot', () => {
    expect(ok('faq[2].question')).toEqual({
      path: [{ field: 'faq', index: 2 }, { field: 'question' }],
    });
  });

  it('reads a relation lookup key', () => {
    expect(ok('author:email')).toEqual({
      path: [{ field: 'author' }],
      lookupKey: 'email',
    });
  });

  it('reads a relation nested inside a component', () => {
    expect(ok('block[0].author:slug')).toEqual({
      path: [{ field: 'block', index: 0 }, { field: 'author' }],
      lookupKey: 'slug',
    });
  });

  it('accepts underscores and digits inside names', () => {
    expect(ok('field_1.sub_2')).toEqual({
      path: [{ field: 'field_1' }, { field: 'sub_2' }],
    });
  });

  it.each([
    ['', 'empty_header'],
    [':email', 'missing_field_path'],
    ['author:email:extra', 'multiple_lookup_separators'],
    ['1title', 'invalid_segment'],
    ['has space', 'invalid_segment'],
    ['faq[].question', 'invalid_segment'],
    ['faq[-1].question', 'invalid_segment'],
    ['author:not-a-name', 'invalid_lookup_key'],
    ['__proto__', 'unsafe_field_name'],
    ['seo.__proto__', 'unsafe_field_name'],
    ['author:__proto__', 'unsafe_field_name'],
    ['constructor.x', 'unsafe_field_name'],
  ])('rejects %j with code %s', (header, code) => {
    expect(fail(header).code).toBe(code);
  });

  it('rejects a path deeper than the limit', () => {
    const header = Array.from({ length: MAX_PATH_DEPTH + 1 }, (_, i) => `f${i}`).join('.');
    expect(fail(header).code).toBe('path_too_deep');
  });

  it('rejects a repeatable index above the limit', () => {
    expect(fail(`faq[${MAX_REPEATABLE_INDEX + 1}].q`).code).toBe('index_out_of_range');
  });

  it('strips a BOM and surrounding whitespace', () => {
    expect(ok('\uFEFF  title  ')).toEqual({ path: [{ field: 'title' }] });
    expect(normaliseHeader('\uFEFFtitle ')).toBe('title');
  });
});

describe('formatHeader', () => {
  it.each([
    'title',
    'seo.metaTitle',
    'faq[0].question',
    'faq[12].answer',
    'author:email',
    'block[3].author:slug',
    'a.b.c.d',
  ])('round trips %s', (header) => {
    expect(formatHeader(ok(header))).toBe(header);
  });
});

describe('withIndex', () => {
  it('stamps an index onto the requested depth only', () => {
    const path = [{ field: 'faq' }, { field: 'question' }];
    expect(withIndex(path, 0, 4)).toEqual([{ field: 'faq', index: 4 }, { field: 'question' }]);
  });

  it('does not mutate the source path', () => {
    const path = [{ field: 'faq' }, { field: 'question' }];
    withIndex(path, 0, 1);
    expect(path).toEqual([{ field: 'faq' }, { field: 'question' }]);
  });
});

describe('multi-value cells', () => {
  it('joins and splits a simple list', () => {
    expect(joinMultiValue(['news', 'sport'], ';')).toBe('news;sport');
    expect(splitMultiValue('news;sport', ';')).toEqual(['news', 'sport']);
  });

  it('treats an empty cell as no values', () => {
    expect(splitMultiValue('', ';')).toEqual([]);
    expect(splitMultiValue('   ', ';')).toEqual([]);
  });

  it('drops empty entries from a trailing delimiter', () => {
    expect(splitMultiValue('news;;sport;', ';')).toEqual(['news', 'sport']);
  });

  it('escapes a delimiter that appears inside a value', () => {
    expect(escapeMultiValue('a;b', ';')).toBe('a\\;b');
    expect(splitMultiValue('a\\;b;c', ';')).toEqual(['a;b', 'c']);
  });

  it('escapes a literal backslash', () => {
    expect(escapeMultiValue('a\\b', ';')).toBe('a\\\\b');
    expect(splitMultiValue('a\\\\b;c', ';')).toEqual(['a\\b', 'c']);
  });

  it.each([
    [['plain', 'values']],
    [['has;delimiter', 'plain']],
    [['has\\backslash', 'and\\;both']],
    [['trailing\\', 'leading;']],
    [['\\;\\;', 'x']],
  ])('round trips %j through a semicolon cell', (values) => {
    expect(splitMultiValue(joinMultiValue(values, ';'), ';')).toEqual(values);
  });

  it('round trips through a pipe cell', () => {
    const values = ['a|b', 'c', 'd\\e'];
    expect(splitMultiValue(joinMultiValue(values, '|'), '|')).toEqual(values);
  });
});

describe('suggestColumn', () => {
  it('matches a changed case', () => {
    expect(suggestColumn('Title', ['title', 'slug'])).toBe('title');
  });

  it('matches a stray separator', () => {
    expect(suggestColumn('meta_title', ['metaTitle'])).toBe('metaTitle');
  });

  it('returns nothing for an unrelated header', () => {
    expect(suggestColumn('nonsense', ['title', 'slug'])).toBeUndefined();
  });
});
