import { DEFAULT_RELATION_LOOKUP_KEY, MEDIA_UID, isSensitiveAttribute } from './schema';
import type {
  ComponentAttribute,
  DynamicZoneAttribute,
  RelationAttribute,
  SchemaResolver,
  StrapiAttribute,
} from './types';

export type PopulateTree = Record<string, unknown>;

const MEDIA_FIELDS = ['id', 'name', 'url', 'hash', 'ext', 'mime'];
const MORPH_RELATIONS = new Set(['morphToOne', 'morphToMany', 'morphOne', 'morphMany']);

export interface PopulateOptions {
  maxDepth?: number;
  /** Target content-type uid to the attribute used for matching that target. */
  relationLookupKeys?: Record<string, string>;
  excludeFields?: readonly string[];
}

/**
 * Builds a `populate` tree from the schema rather than from the resolved columns.
 *
 * Relations and media are narrowed to the few fields the exporter actually writes, which keeps a
 * join from dragging a whole related record — including its private attributes — into memory.
 */
export function buildPopulate(
  resolver: SchemaResolver,
  uid: string,
  options: PopulateOptions = {}
): PopulateTree {
  const schema = resolver.getContentType(uid);
  if (!schema) return {};

  const settings = {
    maxDepth: Math.max(1, options.maxDepth ?? 3),
    relationLookupKeys: options.relationLookupKeys ?? {},
    excludeFields: new Set(options.excludeFields ?? []),
  };

  const tree: PopulateTree = {};

  for (const [name, attribute] of Object.entries(schema.attributes)) {
    if (settings.excludeFields.has(name)) continue;
    if (isSensitiveAttribute(attribute)) continue;

    const branch = branchFor(resolver, settings, attribute, 1, new Set([uid]));
    if (branch !== undefined) tree[name] = branch;
  }

  return tree;
}

type ResolvedPopulateOptions = {
  maxDepth: number;
  relationLookupKeys: Record<string, string>;
  excludeFields: Set<string>;
};

function branchFor(
  resolver: SchemaResolver,
  options: ResolvedPopulateOptions,
  attribute: StrapiAttribute,
  depth: number,
  visited: ReadonlySet<string>
): unknown {
  switch (attribute.type) {
    case 'media':
      return { fields: MEDIA_FIELDS };

    case 'relation': {
      const relation = attribute as RelationAttribute;
      if (MORPH_RELATIONS.has(relation.relation) || !relation.target) return undefined;

      if (relation.target === MEDIA_UID) return { fields: MEDIA_FIELDS };

      const lookupKey = options.relationLookupKeys[relation.target];
      const fields = new Set([DEFAULT_RELATION_LOOKUP_KEY, 'id']);
      if (lookupKey) fields.add(lookupKey);

      return { fields: [...fields] };
    }

    case 'component': {
      const component = attribute as ComponentAttribute;
      if (depth >= options.maxDepth || visited.has(component.component)) return true;

      const schema = resolver.getComponent(component.component);
      if (!schema) return true;

      const nested = nestedTree(
        resolver,
        options,
        schema.attributes,
        depth + 1,
        new Set(visited).add(component.component)
      );

      return Object.keys(nested).length > 0 ? { populate: nested } : true;
    }

    case 'dynamiczone': {
      const zone = attribute as DynamicZoneAttribute;
      if (depth >= options.maxDepth) return true;

      // A dynamic zone needs its components named explicitly to populate their own relations and
      // nested components; a bare `true` stops at the components' scalar fields.
      const on: Record<string, unknown> = {};

      for (const componentUid of zone.components) {
        const schema = resolver.getComponent(componentUid);
        if (!schema) continue;

        const nested = nestedTree(
          resolver,
          options,
          schema.attributes,
          depth + 1,
          new Set(visited).add(componentUid)
        );
        on[componentUid] = Object.keys(nested).length > 0 ? { populate: nested } : {};
      }

      return Object.keys(on).length > 0 ? { on } : true;
    }

    default:
      return undefined;
  }
}

function nestedTree(
  resolver: SchemaResolver,
  options: ResolvedPopulateOptions,
  attributes: Record<string, StrapiAttribute>,
  depth: number,
  visited: ReadonlySet<string>
): PopulateTree {
  const tree: PopulateTree = {};

  for (const [name, attribute] of Object.entries(attributes)) {
    if (isSensitiveAttribute(attribute)) continue;

    const branch = branchFor(resolver, options, attribute, depth, visited);
    if (branch !== undefined) tree[name] = branch;
  }

  return tree;
}
