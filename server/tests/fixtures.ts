import type {
  ComponentSchema,
  ContentTypeSchema,
  SchemaResolver,
  StrapiAttribute,
} from '../src/core/types';
import type { CollectionConfig, PluginSettings } from '../src/services/settings';

export const ARTICLE_UID = 'api::article.article';
export const AUTHOR_UID = 'api::author.author';
export const TAG_UID = 'api::tag.tag';

const attributes = (map: Record<string, StrapiAttribute>) => map;

export const authorSchema: ContentTypeSchema = {
  uid: AUTHOR_UID,
  kind: 'collectionType',
  info: { displayName: 'Author', singularName: 'author' },
  attributes: attributes({
    name: { type: 'string', required: true },
    email: { type: 'email', unique: true },
    slug: { type: 'uid' },
    bio: { type: 'text' },
  }),
};

export const tagSchema: ContentTypeSchema = {
  uid: TAG_UID,
  kind: 'collectionType',
  info: { displayName: 'Tag', singularName: 'tag' },
  attributes: attributes({
    name: { type: 'string', required: true },
    slug: { type: 'uid' },
  }),
};

export const seoComponent: ComponentSchema = {
  uid: 'shared.seo',
  info: { displayName: 'Seo' },
  attributes: attributes({
    metaTitle: { type: 'string', maxLength: 60 },
    metaDescription: { type: 'text' },
    shareImage: { type: 'media', multiple: false },
    internalNote: { type: 'string', private: true },
  }),
};

export const faqComponent: ComponentSchema = {
  uid: 'shared.faq',
  info: { displayName: 'Faq' },
  attributes: attributes({
    question: { type: 'string', required: true },
    answer: { type: 'text' },
  }),
};

export const heroComponent: ComponentSchema = {
  uid: 'blocks.hero',
  info: { displayName: 'Hero' },
  attributes: attributes({
    heading: { type: 'string' },
    image: { type: 'media', multiple: false },
  }),
};

export const ctaComponent: ComponentSchema = {
  uid: 'blocks.cta',
  info: { displayName: 'Cta' },
  attributes: attributes({
    label: { type: 'string' },
    url: { type: 'string' },
  }),
};

export const articleSchema: ContentTypeSchema = {
  uid: ARTICLE_UID,
  kind: 'collectionType',
  info: { displayName: 'Article', singularName: 'article' },
  options: { draftAndPublish: true },
  pluginOptions: { i18n: { localized: true } },
  attributes: attributes({
    title: { type: 'string', required: true, maxLength: 120 },
    slug: { type: 'uid' },
    body: { type: 'text' },
    excerpt: { type: 'string', maxLength: 50 },
    views: { type: 'integer', min: 0 },
    rating: { type: 'decimal' },
    featured: { type: 'boolean' },
    state: { type: 'enumeration', enum: ['draft', 'review', 'live'] },
    publishDate: { type: 'date' },
    readAt: { type: 'datetime' },
    metadata: { type: 'json' },

    internalSecret: { type: 'string', private: true },
    password: { type: 'password' },

    seo: { type: 'component', component: 'shared.seo' },
    faq: { type: 'component', component: 'shared.faq', repeatable: true },
    sections: { type: 'dynamiczone', components: ['blocks.hero', 'blocks.cta'] },

    author: { type: 'relation', relation: 'manyToOne', target: AUTHOR_UID },
    tags: { type: 'relation', relation: 'manyToMany', target: TAG_UID },
    related: { type: 'relation', relation: 'morphToMany' },
    orphan: { type: 'relation', relation: 'oneToOne' },

    cover: { type: 'media', multiple: false },
    gallery: { type: 'media', multiple: true },

    createdBy: { type: 'relation', relation: 'oneToOne', target: 'admin::user' },
    updatedBy: { type: 'relation', relation: 'oneToOne', target: 'admin::user' },
    localizations: { type: 'relation', relation: 'oneToMany', target: ARTICLE_UID },

    createdAt: { type: 'datetime' },
    updatedAt: { type: 'datetime' },
  }),
};

const CONTENT_TYPES: Record<string, ContentTypeSchema> = {
  [ARTICLE_UID]: articleSchema,
  [AUTHOR_UID]: authorSchema,
  [TAG_UID]: tagSchema,
};

const COMPONENTS: Record<string, ComponentSchema> = {
  'shared.seo': seoComponent,
  'shared.faq': faqComponent,
  'blocks.hero': heroComponent,
  'blocks.cta': ctaComponent,
};

export const resolver: SchemaResolver = {
  getContentType: (uid) => CONTENT_TYPES[uid],
  getComponent: (uid) => COMPONENTS[uid],
};

export function makeSettings(overrides: Partial<PluginSettings> = {}): PluginSettings {
  return {
    collections: {},
    roleGrants: {},
    csvDelimiter: ',',
    multiValueDelimiter: ';',
    escapeFormulas: true,
    includeBom: true,
    mediaLookupKey: 'name',
    defaultImportMode: 'upsert',
    maxFileSizeMb: 50,
    maxRows: 200_000,
    maxColumns: 200,
    maxCellLengthKb: 100,
    batchSize: 50,
    templateRepeatableSlots: 3,
    maxComponentDepth: 3,
    jobRetentionDays: 30,
    ...overrides,
  };
}

export function makeCollectionConfig(overrides: Partial<CollectionConfig> = {}): CollectionConfig {
  return {
    enabled: true,
    allowImport: true,
    allowExport: true,
    excludeFields: [],
    relationLookupKeys: {},
    relationLabelKeys: {},
    identifierField: 'documentId',
    ...overrides,
  };
}
