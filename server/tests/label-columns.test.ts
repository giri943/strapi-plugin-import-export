import { describe, expect, it } from 'vitest';
import {
  buildColumns,
  guessLabelKey,
  isUsableLabelKey,
  isUsableLookupKey,
  listUsableLabelKeys,
} from '../src/core/schema';
import { buildPopulate } from '../src/core/populate';
import { renderRow } from '../src/core/render-row';
import { ARTICLE_UID, AUTHOR_UID, TAG_UID, authorSchema, resolver, tagSchema } from './fixtures';

const RENDER = { multiValueDelimiter: ';', escapeFormulas: true };

const headers = (options = {}) =>
  buildColumns(resolver, ARTICLE_UID, { repeatableColumns: 1, ...options }).map((c) => c.header);

describe('isUsableLabelKey', () => {
  it('accepts a plain non-unique string, which a lookup key would reject', () => {
    // Tag.name is required but not unique. This difference is the whole reason label keys exist.
    expect(isUsableLookupKey(tagSchema, 'name')).toBe(false);
    expect(isUsableLabelKey(tagSchema, 'name')).toBe(true);
  });

  it('accepts text, email, uid, enumeration and integer fields', () => {
    expect(isUsableLabelKey(authorSchema, 'bio')).toBe(true);
    expect(isUsableLabelKey(authorSchema, 'email')).toBe(true);
    expect(isUsableLabelKey(tagSchema, 'slug')).toBe(true);
  });

  it('refuses an unknown field', () => {
    expect(isUsableLabelKey(tagSchema, 'nope')).toBe(false);
  });

  it('refuses a private field and a password field', () => {
    const schema = {
      uid: 'api::x.x',
      attributes: {
        secret: { type: 'string' as const, private: true },
        password: { type: 'password' as const },
      },
    };

    expect(isUsableLabelKey(schema, 'secret')).toBe(false);
    expect(isUsableLabelKey(schema, 'password')).toBe(false);
  });

  it('refuses a relation or component, which cannot render into one cell', () => {
    const schema = {
      uid: 'api::x.x',
      attributes: {
        owner: { type: 'relation' as const, relation: 'oneToOne' as const, target: AUTHOR_UID },
        seo: { type: 'component' as const, component: 'shared.seo' },
      },
    };

    expect(isUsableLabelKey(schema, 'owner')).toBe(false);
    expect(isUsableLabelKey(schema, 'seo')).toBe(false);
  });
});

describe('guessLabelKey', () => {
  it('prefers name', () => {
    expect(guessLabelKey(tagSchema)).toBe('name');
    expect(guessLabelKey(authorSchema)).toBe('name');
  });

  it('falls back through the usual label names', () => {
    expect(guessLabelKey({ uid: 'x', attributes: { title: { type: 'string' } } })).toBe('title');
    expect(guessLabelKey({ uid: 'x', attributes: { label: { type: 'string' } } })).toBe('label');
    expect(
      guessLabelKey({ uid: 'x', attributes: { displayName: { type: 'string' } } })
    ).toBe('displayName');
  });

  it('returns nothing when there is no readable candidate', () => {
    expect(guessLabelKey({ uid: 'x', attributes: { count: { type: 'boolean' } } })).toBeUndefined();
  });
});

describe('label columns', () => {
  it('adds a readable column beside the relation match column', () => {
    const list = headers();

    expect(list).toContain('author:documentId');
    expect(list).toContain('author:name');
    expect(list).toContain('tags:documentId');
    expect(list).toContain('tags:name');
  });

  it('marks the label column read-only so an import ignores it', () => {
    const label = buildColumns(resolver, ARTICLE_UID).find((c) => c.header === 'author:name');

    expect(label?.readOnly).toBe(true);
    expect(label?.isLabel).toBe(true);
    expect(label?.requiredInFile).toBe(false);
  });

  it('leaves the match column importable', () => {
    const match = buildColumns(resolver, ARTICLE_UID).find((c) => c.header === 'author:documentId');

    expect(match?.readOnly).toBe(false);
    expect(match?.isLabel).toBeUndefined();
  });

  it('keeps the label beside a configured non-documentId match key', () => {
    const list = headers({ relationLookupKeys: { [AUTHOR_UID]: 'email' } });

    expect(list).toContain('author:email');
    expect(list).toContain('author:name');
  });

  it('omits the label when it would duplicate the match column', () => {
    const list = headers({
      relationLookupKeys: { [TAG_UID]: 'slug' },
      relationLabelKeys: { [TAG_UID]: 'slug' },
    });

    expect(list.filter((header) => header === 'tags:slug')).toHaveLength(1);
  });

  it('omits the label when a target is explicitly configured to none', () => {
    const list = headers({ relationLabelKeys: { [AUTHOR_UID]: '' } });

    expect(list).toContain('author:documentId');
    expect(list).not.toContain('author:name');
  });

  it('honours an explicit label key over the guess', () => {
    const list = headers({ relationLabelKeys: { [AUTHOR_UID]: 'email' } });

    expect(list).toContain('author:email');
    expect(list).not.toContain('author:name');
  });

  it('ignores a label key the target cannot render', () => {
    const list = headers({ relationLabelKeys: { [AUTHOR_UID]: 'nope' } });

    expect(list).toContain('author:documentId');
    expect(list).not.toContain('author:nope');
  });

  it('adds no media label column by default, because media already matches on a readable name', () => {
    const list = headers();

    expect(list).toContain('cover:name');
    expect(list.filter((header) => header.startsWith('cover:'))).toHaveLength(1);
  });

  it('adds a media label column when media is matched on something opaque', () => {
    const list = headers({ mediaLookupKey: 'hash', mediaLabelKey: 'name' });

    expect(list).toContain('cover:hash');
    expect(list).toContain('cover:name');
  });

  it('produces no duplicate headers', () => {
    const list = headers({ relationLookupKeys: { [AUTHOR_UID]: 'email', [TAG_UID]: 'slug' } });

    expect(new Set(list).size).toBe(list.length);
  });
});

describe('rendering a label column', () => {
  const columns = buildColumns(resolver, ARTICLE_UID, { repeatableColumns: 1 });

  const cells = (document: Record<string, unknown>) => {
    const values = renderRow(document, columns, RENDER);
    const map = new Map<string, string>();
    columns.forEach((column, index) => map.set(column.header, values[index]));
    return map;
  };

  it('writes the id in the match column and the name in the label column', () => {
    const row = cells({ author: { documentId: 'auth-1', name: 'Ada Lovelace' } });

    expect(row.get('author:documentId')).toBe('auth-1');
    expect(row.get('author:name')).toBe('Ada Lovelace');
  });

  it('writes a delimited list of labels for a many relation', () => {
    const row = cells({
      tags: [
        { documentId: 't1', name: 'News' },
        { documentId: 't2', name: 'Sport' },
      ],
    });

    expect(row.get('tags:documentId')).toBe('t1;t2');
    expect(row.get('tags:name')).toBe('News;Sport');
  });

  it('leaves both blank for an empty relation', () => {
    const row = cells({ author: null });

    expect(row.get('author:documentId')).toBe('');
    expect(row.get('author:name')).toBe('');
  });
});

describe('populate includes the label field', () => {
  it('requests the guessed label so the column is not blank', () => {
    const tree = buildPopulate(resolver, ARTICLE_UID) as Record<string, any>;

    expect(tree.author.fields).toContain('name');
    expect(tree.author.fields).toContain('documentId');
  });

  it('requests both the configured match key and the configured label', () => {
    const tree = buildPopulate(resolver, ARTICLE_UID, {
      relationLookupKeys: { [AUTHOR_UID]: 'email' },
      relationLabelKeys: { [AUTHOR_UID]: 'name' },
    }) as Record<string, any>;

    expect(tree.author.fields).toEqual(expect.arrayContaining(['documentId', 'email', 'name']));
  });

  it('does not request a label that was switched off', () => {
    const tree = buildPopulate(resolver, ARTICLE_UID, {
      relationLabelKeys: { [AUTHOR_UID]: '' },
    }) as Record<string, any>;

    expect(tree.author.fields).not.toContain('name');
  });
});

describe('listUsableLabelKeys', () => {
  it('lists every readable attribute of the target', () => {
    expect(listUsableLabelKeys(tagSchema).sort()).toEqual(['name', 'slug']);
  });
});
