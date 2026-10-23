import type { Core } from '@strapi/strapi';
import { BLOCKED_ATTRIBUTE_NAMES, BLOCKED_CONTENT_TYPES, PLUGIN_NAME } from '../constants';
import {
  buildColumns,
  displayNameOf,
  hasDraftAndPublish,
  isLocalized,
  listUsableLookupKeys,
} from '../core/schema';
import type { ColumnDescriptor, ContentTypeSchema } from '../core/types';
import { createSchemaResolver, listApiCollectionTypes } from '../utils/strapi-schema';
import type { CollectionConfig, PluginSettings } from './settings';

export interface CollectionSummary {
  uid: string;
  displayName: string;
  apiId?: string;
  draftAndPublish: boolean;
  localized: boolean;
  /** Lookup keys other collections may use to point at this one. */
  lookupKeys: string[];
  columnCount: number;
}

export interface CollectionDescription extends CollectionSummary {
  columns: ColumnDescriptor[];
  relationTargets: Array<{ uid: string; displayName: string; lookupKeys: string[] }>;
  unsupported: Array<{ field: string; reason: string }>;
}

export function isBlockedContentType(uid: string): boolean {
  return BLOCKED_CONTENT_TYPES.includes(uid);
}

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const resolver = () => createSchemaResolver(strapi);

  /** Collections an administrator is allowed to pick from in the settings page. */
  function listCandidates(): CollectionSummary[] {
    return listApiCollectionTypes(strapi)
      .filter((schema) => !isBlockedContentType(schema.uid))
      .map((schema) => summarise(schema, 0));
  }

  function summarise(schema: ContentTypeSchema, columnCount: number): CollectionSummary {
    return {
      uid: schema.uid,
      displayName: displayNameOf(schema),
      apiId: schema.info?.singularName,
      draftAndPublish: hasDraftAndPublish(schema),
      localized: isLocalized(schema),
      lookupKeys: listUsableLookupKeys(schema),
      columnCount,
    };
  }

  function columnOptionsFor(settings: PluginSettings, collection: CollectionConfig) {
    return {
      repeatableColumns: settings.templateRepeatableSlots,
      maxDepth: settings.maxComponentDepth,
      relationLookupKeys: collection.relationLookupKeys,
      mediaLookupKey: settings.mediaLookupKey,
      excludeFields: [...collection.excludeFields, ...BLOCKED_ATTRIBUTE_NAMES],
    };
  }

  function columnsFor(
    uid: string,
    settings: PluginSettings,
    collection: CollectionConfig
  ): ColumnDescriptor[] {
    return buildColumns(resolver(), uid, columnOptionsFor(settings, collection));
  }

  function describe(
    uid: string,
    settings: PluginSettings,
    collection: CollectionConfig
  ): CollectionDescription | undefined {
    const schema = resolver().getContentType(uid);
    if (!schema || isBlockedContentType(uid)) return undefined;

    const columns = columnsFor(uid, settings, collection);
    const relationTargets = collectRelationTargets(columns);

    return {
      ...summarise(schema, columns.length),
      columns,
      relationTargets,
      unsupported: listUnsupported(schema),
    };
  }

  function collectRelationTargets(columns: readonly ColumnDescriptor[]) {
    const seen = new Map<string, { uid: string; displayName: string; lookupKeys: string[] }>();

    for (const column of columns) {
      if (column.kind !== 'relation' || !column.targetUid) continue;
      if (seen.has(column.targetUid)) continue;

      const target = resolver().getContentType(column.targetUid);
      if (!target) continue;

      seen.set(column.targetUid, {
        uid: column.targetUid,
        displayName: displayNameOf(target),
        lookupKeys: listUsableLookupKeys(target),
      });
    }

    return [...seen.values()];
  }

  /**
   * Fields the plugin knowingly leaves out, surfaced to the admin UI so an operator can see why
   * a column is missing instead of assuming the template is broken.
   */
  function listUnsupported(schema: ContentTypeSchema): Array<{ field: string; reason: string }> {
    const out: Array<{ field: string; reason: string }> = [];

    for (const [name, attribute] of Object.entries(schema.attributes)) {
      if (attribute.type === 'password') {
        out.push({ field: name, reason: 'Password fields are never exported or imported.' });
        continue;
      }
      if (attribute.private === true) {
        out.push({ field: name, reason: 'Marked private in the schema.' });
        continue;
      }
      if (attribute.type === 'relation') {
        const relation = attribute as { relation?: string; target?: string };
        if (relation.relation?.startsWith('morph')) {
          out.push({
            field: name,
            reason: 'Polymorphic relations have no single target, so they cannot be a CSV column.',
          });
        } else if (!relation.target) {
          out.push({ field: name, reason: 'Relation has no resolvable target.' });
        }
      }
    }

    return out;
  }

  return {
    listCandidates,
    columnsFor,
    columnOptionsFor,
    describe,

    getContentType(uid: string): ContentTypeSchema | undefined {
      return resolver().getContentType(uid);
    },

    /** True when the uid names a real, importable/exportable collection type. */
    isUsableCollection(uid: string): boolean {
      if (isBlockedContentType(uid)) return false;
      if (!uid.startsWith('api::')) return false;

      const schema = resolver().getContentType(uid);
      if (!schema) return false;

      if (schema.kind !== 'collectionType') {
        strapi.log.debug(
          `[${PLUGIN_NAME}] ${uid} is a ${schema.kind}; only collection types are supported.`
        );
        return false;
      }

      return true;
    },
  };
};
