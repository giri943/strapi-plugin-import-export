import { describe, expect, it } from 'vitest';
import { buildColumns } from '../src/core/schema';
import { renderRow } from '../src/core/render-row';
import { splitMultiValue } from '../src/core/columns';
import { ARTICLE_UID, AUTHOR_UID, TAG_UID, resolver } from './fixtures';

const OPTIONS = { multiValueDelimiter: ';', escapeFormulas: true };

const columns = buildColumns(resolver, ARTICLE_UID, {
  repeatableColumns: 2,
  relationLookupKeys: { [AUTHOR_UID]: 'email', [TAG_UID]: 'slug' },
});

const cellsOf = (document: Record<string, unknown>) => {
  const values = renderRow(document, columns, OPTIONS);
  const map = new Map<string, string>();

  columns.forEach((column, index) => map.set(column.header, values[index]));

  return map;
};

describe('renderRow', () => {
  it('writes one cell per column, in column order', () => {
    const values = renderRow({ title: 'Hello' }, columns, OPTIONS);
    expect(values).toHaveLength(columns.length);
  });

  it('renders scalars and leaves missing values blank', () => {
    const cells = cellsOf({ title: 'Hello', views: 42, featured: true, rating: 4.25 });

    expect(cells.get('title')).toBe('Hello');
    expect(cells.get('views')).toBe('42');
    expect(cells.get('featured')).toBe('true');
    expect(cells.get('rating')).toBe('4.25');
    expect(cells.get('body')).toBe('');
  });

  it('renders a nested component value', () => {
    const cells = cellsOf({ seo: { metaTitle: 'Meta' } });
    expect(cells.get('seo.metaTitle')).toBe('Meta');
  });

  it('renders repeatable component entries into their indexed columns', () => {
    const cells = cellsOf({
      faq: [
        { question: 'Why?', answer: 'Because' },
        { question: 'How?', answer: 'Like this' },
      ],
    });

    expect(cells.get('faq[0].question')).toBe('Why?');
    expect(cells.get('faq[1].answer')).toBe('Like this');
  });

  it('leaves unused repeatable slots blank', () => {
    const cells = cellsOf({ faq: [{ question: 'Only one' }] });

    expect(cells.get('faq[0].question')).toBe('Only one');
    expect(cells.get('faq[1].question')).toBe('');
  });

  it('renders a dynamic zone as JSON', () => {
    const sections = [{ __component: 'blocks.hero', heading: 'Hi' }];
    const cells = cellsOf({ sections });

    expect(JSON.parse(cells.get('sections') as string)).toEqual(sections);
  });

  it('renders an empty dynamic zone as a blank cell rather than []', () => {
    expect(cellsOf({ sections: [] }).get('sections')).toBe('');
  });

  it('renders a single relation using the configured key', () => {
    const cells = cellsOf({ author: { documentId: 'abc', email: 'a@b.co' } });
    expect(cells.get('author:email')).toBe('a@b.co');
  });

  it('falls back to documentId when the configured key is empty', () => {
    const cells = cellsOf({ author: { documentId: 'abc', email: null } });
    expect(cells.get('author:email')).toBe('abc');
  });

  it('renders a many relation as a delimited list', () => {
    const cells = cellsOf({ tags: [{ slug: 'news' }, { slug: 'sport' }] });
    expect(cells.get('tags:slug')).toBe('news;sport');
  });

  it('escapes a delimiter inside a relation key so the list survives a round trip', () => {
    const cells = cellsOf({ tags: [{ slug: 'a;b' }, { slug: 'c' }] });

    expect(cells.get('tags:slug')).toBe('a\\;b;c');
    expect(splitMultiValue(cells.get('tags:slug') as string, ';')).toEqual(['a;b', 'c']);
  });

  it('renders an empty relation as a blank cell', () => {
    expect(cellsOf({ author: null }).get('author:email')).toBe('');
    expect(cellsOf({ tags: [] }).get('tags:slug')).toBe('');
  });

  it('renders media by the configured key', () => {
    const cells = cellsOf({
      cover: { id: 1, name: 'hero.webp' },
      gallery: [
        { id: 2, name: 'a.png' },
        { id: 3, name: 'b.png' },
      ],
    });

    expect(cells.get('cover:name')).toBe('hero.webp');
    expect(cells.get('gallery:name')).toBe('a.png;b.png');
  });

  it('renders json as compact JSON', () => {
    expect(cellsOf({ metadata: { a: 1 } }).get('metadata')).toBe('{"a":1}');
  });

  it('neutralises a formula payload', () => {
    expect(cellsOf({ title: '=cmd|calc' }).get('title')).toBe("'=cmd|calc");
  });

  it('leaves a negative number alone despite the leading minus', () => {
    expect(cellsOf({ rating: -4.5 }).get('rating')).toBe('-4.5');
  });

  it('does not neutralise formulas when the setting is off', () => {
    const values = renderRow({ title: '=1+1' }, columns, {
      multiValueDelimiter: ';',
      escapeFormulas: false,
    });

    expect(values[columns.findIndex((c) => c.header === 'title')]).toBe('=1+1');
  });

  it('renders the documentId meta column', () => {
    expect(cellsOf({ documentId: 'doc-1' }).get('documentId')).toBe('doc-1');
  });

  it('never renders a private or password field, even if the document carries one', () => {
    const cells = cellsOf({ internalSecret: 'leak', password: 'hunter2' });

    expect(cells.has('internalSecret')).toBe(false);
    expect(cells.has('password')).toBe(false);
    expect([...cells.values()].join('|')).not.toContain('leak');
    expect([...cells.values()].join('|')).not.toContain('hunter2');
  });
});
