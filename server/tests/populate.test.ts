import { describe, expect, it } from 'vitest';
import { buildPopulate } from '../src/core/populate';
import { ARTICLE_UID, AUTHOR_UID, resolver } from './fixtures';

const tree = (options = {}) => buildPopulate(resolver, ARTICLE_UID, options) as Record<string, any>;

describe('buildPopulate', () => {
  it('does not populate plain scalars', () => {
    const populate = tree();

    expect(populate.title).toBeUndefined();
    expect(populate.views).toBeUndefined();
    expect(populate.metadata).toBeUndefined();
  });

  it('narrows a relation to the identifying fields only', () => {
    const populate = tree({ relationLookupKeys: { [AUTHOR_UID]: 'email' } });

    expect(populate.author.fields).toContain('documentId');
    expect(populate.author.fields).toContain('email');
    // A whole related record would drag its other columns, including private ones, into memory.
    expect(populate.author.fields).not.toContain('bio');
  });

  it('asks only for documentId and id when no key is configured', () => {
    expect(tree().author.fields.sort()).toEqual(['documentId', 'id']);
  });

  it('narrows media to the file identity fields', () => {
    const populate = tree();

    expect(populate.cover.fields).toEqual(expect.arrayContaining(['id', 'name', 'url', 'hash']));
    expect(populate.gallery.fields).toEqual(expect.arrayContaining(['id', 'name']));
  });

  it('recurses into a component and its nested media', () => {
    const populate = tree();

    expect(populate.seo.populate).toBeDefined();
    expect(populate.seo.populate.shareImage.fields).toContain('name');
  });

  it('leaves a component with only scalars as a plain true', () => {
    expect(tree().faq).toBe(true);
  });

  it('names every component of a dynamic zone so their own relations populate', () => {
    const populate = tree();

    expect(populate.sections.on).toBeDefined();
    expect(Object.keys(populate.sections.on).sort()).toEqual(['blocks.cta', 'blocks.hero']);
    expect(populate.sections.on['blocks.hero'].populate.image.fields).toContain('name');
  });

  it('skips polymorphic relations and relations with no target', () => {
    const populate = tree();

    expect(populate.related).toBeUndefined();
    expect(populate.orphan).toBeUndefined();
  });

  it('never populates a private field or a component path into one', () => {
    const populate = tree();

    expect(populate.internalSecret).toBeUndefined();
    expect(populate.seo.populate.internalNote).toBeUndefined();
  });

  it('honours excluded fields', () => {
    const populate = tree({ excludeFields: ['seo', 'gallery'] });

    expect(populate.seo).toBeUndefined();
    expect(populate.gallery).toBeUndefined();
    expect(populate.cover).toBeDefined();
  });

  it('stops at the depth limit', () => {
    const populate = tree({ maxDepth: 1 });

    expect(populate.seo).toBe(true);
    expect(populate.sections).toBe(true);
  });

  it('returns an empty tree for an unknown content type', () => {
    expect(buildPopulate(resolver, 'api::nope.nope')).toEqual({});
  });
});
