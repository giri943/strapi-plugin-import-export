import type { Core } from '@strapi/strapi';
import type { ComponentSchema, ContentTypeSchema, SchemaResolver } from '../core/types';

export function createSchemaResolver(strapi: Core.Strapi): SchemaResolver {
  return {
    getContentType(uid) {
      const schema = strapi.contentTypes[uid as keyof typeof strapi.contentTypes];
      return schema ? ({ ...schema, uid } as unknown as ContentTypeSchema) : undefined;
    },
    getComponent(uid) {
      const schema = strapi.components[uid as keyof typeof strapi.components];
      return schema ? ({ ...schema, uid } as unknown as ComponentSchema) : undefined;
    },
  };
}

export function listApiCollectionTypes(strapi: Core.Strapi): ContentTypeSchema[] {
  return Object.entries(strapi.contentTypes)
    .filter(([uid]) => uid.startsWith('api::'))
    .map(([uid, schema]) => ({ ...schema, uid }) as unknown as ContentTypeSchema)
    .filter((schema) => schema.kind === 'collectionType')
    .sort((a, b) => a.uid.localeCompare(b.uid));
}
