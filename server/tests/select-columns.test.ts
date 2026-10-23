import { describe, expect, it } from 'vitest';
import { asHeaderList, parseColumnsParam, selectColumns } from '../src/core/select-columns';
import { buildColumns } from '../src/core/schema';
import { ARTICLE_UID, resolver } from './fixtures';

const columns = buildColumns(resolver, ARTICLE_UID, { repeatableColumns: 1 });
const headersOf = (selection: { columns: Array<{ header: string }> }) =>
  selection.columns.map((column) => column.header);

describe('selectColumns', () => {
  it('returns everything when nothing is requested', () => {
    expect(selectColumns(columns, undefined).columns).toHaveLength(columns.length);
    expect(selectColumns(columns, undefined).narrowed).toBe(false);
    expect(selectColumns(columns, []).narrowed).toBe(false);
  });

  it('narrows to the requested headers', () => {
    const selection = selectColumns(columns, ['title', 'body']);

    expect(headersOf(selection)).toEqual(['title', 'body']);
    expect(selection.narrowed).toBe(true);
  });

  it('keeps schema order rather than request order', () => {
    const selection = selectColumns(columns, ['body', 'documentId', 'title']);

    // documentId is generated first, then title, then body.
    expect(headersOf(selection)).toEqual(['documentId', 'title', 'body']);
  });

  it('reports headers that match nothing', () => {
    const selection = selectColumns(columns, ['title', 'nonsense']);

    expect(headersOf(selection)).toEqual(['title']);
    expect(selection.unknown).toEqual(['nonsense']);
  });

  /**
   * A private field never reaches the generated column list, so intersecting with it is what
   * makes the request safe: there is nothing to select that was not already on offer.
   */
  it('cannot be used to select a private or password field', () => {
    const selection = selectColumns(columns, ['internalSecret', 'password', 'title']);

    expect(headersOf(selection)).toEqual(['title']);
    expect(selection.unknown.sort()).toEqual(['internalSecret', 'password']);
  });

  it('falls back to everything when no requested header is recognised', () => {
    const selection = selectColumns(columns, ['gone', 'also-gone']);

    expect(selection.columns).toHaveLength(columns.length);
    expect(selection.narrowed).toBe(false);
    expect(selection.unknown.sort()).toEqual(['also-gone', 'gone']);
  });

  it('ignores blank entries and trims whitespace', () => {
    const selection = selectColumns(columns, ['  title  ', '', '   ']);

    expect(headersOf(selection)).toEqual(['title']);
  });

  it('ignores a repeated header', () => {
    expect(headersOf(selectColumns(columns, ['title', 'title']))).toEqual(['title']);
  });

  it('can select a label column', () => {
    const selection = selectColumns(columns, ['author:name']);

    expect(headersOf(selection)).toEqual(['author:name']);
  });

  it('does not mutate the source list', () => {
    const before = columns.length;
    selectColumns(columns, ['title']);

    expect(columns).toHaveLength(before);
  });
});

describe('parseColumnsParam', () => {
  it('splits a comma separated list', () => {
    expect(parseColumnsParam('title,body,author:name')).toEqual(['title', 'body', 'author:name']);
  });

  it('trims and drops blanks', () => {
    expect(parseColumnsParam(' title , , body ')).toEqual(['title', 'body']);
  });

  it('returns undefined for anything empty or not a string', () => {
    expect(parseColumnsParam('')).toBeUndefined();
    expect(parseColumnsParam('   ')).toBeUndefined();
    expect(parseColumnsParam(undefined)).toBeUndefined();
    expect(parseColumnsParam(['title'])).toBeUndefined();
  });
});

describe('asHeaderList', () => {
  it('keeps only non-empty strings', () => {
    expect(asHeaderList(['title', 42, null, '  body  ', ''])).toEqual(['title', 'body']);
  });

  it('returns undefined for a non-array or an empty result', () => {
    expect(asHeaderList('title')).toBeUndefined();
    expect(asHeaderList([])).toBeUndefined();
    expect(asHeaderList([1, 2])).toBeUndefined();
  });
});
