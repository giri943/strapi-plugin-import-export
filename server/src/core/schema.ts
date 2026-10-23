import { formatHeader, withIndex } from './columns';
import type {
  ColumnDescriptor,
  ColumnSegment,
  ComponentAttribute,
  ContentTypeSchema,
  DynamicZoneAttribute,
  MediaAttribute,
  RelationAttribute,
  ScalarAttribute,
  SchemaResolver,
  StrapiAttribute,
} from './types';

export const MEDIA_UID = 'plugin::upload.file';
export const DEFAULT_RELATION_LOOKUP_KEY = 'documentId';
export const DEFAULT_MEDIA_LOOKUP_KEY = 'name';
export const SUPPORTED_MEDIA_LOOKUP_KEYS = ['id', 'name', 'url', 'hash'] as const;

export const META_DOCUMENT_ID = 'documentId';
export const META_LOCALE = 'locale';
export const META_STATUS = 'status';

/** Timestamps Strapi maintains itself. Offered in exports, ignored on import. */
const READ_ONLY_TIMESTAMPS = ['createdAt', 'updatedAt', 'publishedAt'] as const;

/**
 * Timestamps also appear in `schema.attributes`, so the main attribute loop has to skip them.
 * Without this they are emitted twice, and the first copy is not marked read-only — which would
 * let an import try to write `createdAt`.
 */
const TIMESTAMP_NAMES = new Set<string>(READ_ONLY_TIMESTAMPS);

/**
 * Attributes that exist on every content type for Strapi's own bookkeeping. None of them round
 * trip through a CSV in a way an operator would want, so they never become columns.
 */
const SYSTEM_ATTRIBUTES = new Set([
  'createdBy',
  'updatedBy',
  'localizations',
  'strapi_stage',
  'strapi_assignee',
]);

const MORPH_RELATIONS = new Set(['morphToOne', 'morphToMany', 'morphOne', 'morphMany']);

export interface BuildColumnsOptions {
  /** How many slots a repeatable component gets in a template. */
  repeatableColumns?: number;
  /** How deep component nesting may go before it is dropped from the template. */
  maxDepth?: number;
  /** Per-target-content-type attribute used to match relations, keyed by content-type uid. */
  relationLookupKeys?: Record<string, string>;
  mediaLookupKey?: string;
  /** Field paths an administrator has excluded for this collection. */
  excludeFields?: readonly string[];
}

const DEFAULTS = {
  repeatableColumns: 3,
  maxDepth: 3,
  mediaLookupKey: DEFAULT_MEDIA_LOOKUP_KEY,
};

export function isCollectionType(schema: ContentTypeSchema | undefined): boolean {
  return schema?.kind === 'collectionType';
}

export function hasDraftAndPublish(schema: ContentTypeSchema): boolean {
  return schema.options?.draftAndPublish === true;
}

export function isLocalized(schema: ContentTypeSchema): boolean {
  return schema.pluginOptions?.i18n?.localized === true;
}

export function displayNameOf(schema: ContentTypeSchema | ComponentLike): string {
  return schema.info?.displayName ?? schema.uid;
}

type ComponentLike = { uid: string; info?: { displayName?: string } };

/**
 * True when the attribute must never leave the server. Checked before anything else so a private
 * or password field cannot be reached through a component path either.
 */
export function isSensitiveAttribute(attribute: StrapiAttribute): boolean {
  return attribute.private === true || attribute.type === 'password';
}

export function buildColumns(
  resolver: SchemaResolver,
  uid: string,
  options: BuildColumnsOptions = {}
): ColumnDescriptor[] {
  const schema = resolver.getContentType(uid);
  if (!schema) return [];

  const settings = {
    repeatableColumns: Math.max(1, options.repeatableColumns ?? DEFAULTS.repeatableColumns),
    maxDepth: Math.max(1, options.maxDepth ?? DEFAULTS.maxDepth),
    relationLookupKeys: options.relationLookupKeys ?? {},
    mediaLookupKey: options.mediaLookupKey ?? DEFAULTS.mediaLookupKey,
    excludeFields: new Set(options.excludeFields ?? []),
  };

  const columns: ColumnDescriptor[] = [
    {
      header: META_DOCUMENT_ID,
      kind: 'meta',
      path: [{ field: META_DOCUMENT_ID }],
      multiple: false,
      required: false,
      requiredInFile: false,
      readOnly: false,
      hint: 'Leave blank to create a new entry. Fill in to update an existing one.',
    },
  ];

  if (isLocalized(schema)) {
    columns.push({
      header: META_LOCALE,
      kind: 'meta',
      path: [{ field: META_LOCALE }],
      multiple: false,
      required: false,
      requiredInFile: false,
      readOnly: false,
      hint: 'Locale code, for example en or fr. Defaults to the site default locale.',
    });
  }

  if (hasDraftAndPublish(schema)) {
    columns.push({
      header: META_STATUS,
      kind: 'meta',
      path: [{ field: META_STATUS }],
      multiple: false,
      required: false,
      requiredInFile: false,
      readOnly: false,
      hint: 'draft or published. Defaults to draft.',
    });
  }

  for (const [name, attribute] of Object.entries(schema.attributes)) {
    if (SYSTEM_ATTRIBUTES.has(name)) continue;
    if (TIMESTAMP_NAMES.has(name)) continue;
    if (isSensitiveAttribute(attribute)) continue;
    if (settings.excludeFields.has(name)) continue;

    columns.push(
      ...expandAttribute(resolver, settings, [{ field: name }], name, attribute, 1, new Set([uid]))
    );
  }

  for (const name of READ_ONLY_TIMESTAMPS) {
    const attribute = schema.attributes[name];
    if (!attribute && name !== 'publishedAt') continue;
    if (name === 'publishedAt' && !hasDraftAndPublish(schema)) continue;
    if (settings.excludeFields.has(name)) continue;

    columns.push({
      header: name,
      kind: 'scalar',
      path: [{ field: name }],
      attribute: { type: 'datetime' } as ScalarAttribute,
      multiple: false,
      required: false,
      requiredInFile: false,
      readOnly: true,
      hint: 'Managed by Strapi. Present in exports, ignored on import.',
    });
  }

  return columns;
}

type ResolvedOptions = {
  repeatableColumns: number;
  maxDepth: number;
  relationLookupKeys: Record<string, string>;
  mediaLookupKey: string;
  excludeFields: Set<string>;
};

function expandAttribute(
  resolver: SchemaResolver,
  options: ResolvedOptions,
  path: ColumnSegment[],
  pathLabel: string,
  attribute: StrapiAttribute,
  depth: number,
  visitedComponents: ReadonlySet<string>
): ColumnDescriptor[] {
  switch (attribute.type) {
    case 'component':
      return expandComponent(
        resolver,
        options,
        path,
        pathLabel,
        attribute as ComponentAttribute,
        depth,
        visitedComponents
      );

    case 'dynamiczone':
      return [describeDynamicZone(path, attribute as DynamicZoneAttribute)];

    case 'relation':
      return describeRelation(resolver, options, path, attribute as RelationAttribute);

    case 'media':
      return [describeMedia(options, path, attribute as MediaAttribute)];

    case 'json':
      return [
        {
          header: formatHeader({ path }),
          kind: 'json',
          path,
          attribute,
          multiple: false,
          required: attribute.required === true,
          requiredInFile: isTopLevel(path) && attribute.required === true,
          readOnly: false,
          hint: 'JSON value in a single cell.',
        },
      ];

    default:
      return [describeScalar(path, attribute as ScalarAttribute)];
  }
}

function expandComponent(
  resolver: SchemaResolver,
  options: ResolvedOptions,
  path: ColumnSegment[],
  pathLabel: string,
  attribute: ComponentAttribute,
  depth: number,
  visitedComponents: ReadonlySet<string>
): ColumnDescriptor[] {
  if (depth >= options.maxDepth) return [];
  if (visitedComponents.has(attribute.component)) return [];

  const component = resolver.getComponent(attribute.component);
  if (!component) return [];

  const nextVisited = new Set(visitedComponents).add(attribute.component);
  const childDepth = depth + 1;

  const buildFor = (basePath: ColumnSegment[], baseLabel: string): ColumnDescriptor[] => {
    const out: ColumnDescriptor[] = [];

    for (const [childName, childAttribute] of Object.entries(component.attributes)) {
      if (SYSTEM_ATTRIBUTES.has(childName)) continue;
      if (isSensitiveAttribute(childAttribute)) continue;

      const childPath = [...basePath, { field: childName }];
      const childLabel = `${baseLabel} › ${childName}`;
      if (options.excludeFields.has(pathOf(childPath))) continue;

      out.push(
        ...expandAttribute(
          resolver,
          options,
          childPath,
          childLabel,
          childAttribute,
          childDepth,
          nextVisited
        )
      );
    }

    return out;
  };

  if (attribute.repeatable !== true) {
    return buildFor(path, pathLabel);
  }

  const slots = Math.max(1, attribute.max ?? options.repeatableColumns);
  const slotCount = Math.min(slots, options.repeatableColumns);
  const indexDepth = path.length - 1;
  const out: ColumnDescriptor[] = [];

  for (let index = 0; index < slotCount; index += 1) {
    out.push(...buildFor(withIndex(path, indexDepth, index), `${pathLabel}[${index}]`));
  }

  return out;
}

function describeDynamicZone(
  path: ColumnSegment[],
  attribute: DynamicZoneAttribute
): ColumnDescriptor {
  const allowed = attribute.components.join(', ');

  return {
    header: formatHeader({ path }),
    kind: 'dynamiczone',
    path,
    attribute,
    multiple: true,
    required: attribute.required === true,
    requiredInFile: isTopLevel(path) && attribute.required === true,
    readOnly: false,
    hint: `JSON array in a single cell. Every entry needs a "__component" key. Allowed: ${allowed}.`,
  };
}

function describeRelation(
  resolver: SchemaResolver,
  options: ResolvedOptions,
  path: ColumnSegment[],
  attribute: RelationAttribute
): ColumnDescriptor[] {
  if (MORPH_RELATIONS.has(attribute.relation)) return [];
  if (!attribute.target) return [];

  const target = resolver.getContentType(attribute.target);
  if (!target) return [];

  const lookupKey = resolveRelationLookupKey(options, attribute.target, target);
  const multiple = attribute.relation === 'oneToMany' || attribute.relation === 'manyToMany';
  const targetLabel = displayNameOf(target);

  return [
    {
      header: formatHeader({ path, lookupKey }),
      kind: 'relation',
      path,
      attribute,
      lookupKey,
      targetUid: attribute.target,
      multiple,
      required: attribute.required === true,
      requiredInFile: isTopLevel(path) && attribute.required === true,
      readOnly: false,
      hint: multiple
        ? `One or more ${targetLabel} entries matched on "${lookupKey}", separated by the list delimiter.`
        : `A single ${targetLabel} entry matched on "${lookupKey}".`,
    },
  ];
}

function describeMedia(
  options: ResolvedOptions,
  path: ColumnSegment[],
  attribute: MediaAttribute
): ColumnDescriptor {
  const lookupKey = options.mediaLookupKey;
  const multiple = attribute.multiple === true;

  return {
    header: formatHeader({ path, lookupKey }),
    kind: 'media',
    path,
    attribute,
    lookupKey,
    targetUid: MEDIA_UID,
    multiple,
    required: attribute.required === true,
    requiredInFile: isTopLevel(path) && attribute.required === true,
    readOnly: false,
    hint: multiple
      ? `One or more existing Media Library files matched on "${lookupKey}", separated by the list delimiter.`
      : `An existing Media Library file matched on "${lookupKey}".`,
  };
}

function describeScalar(path: ColumnSegment[], attribute: ScalarAttribute): ColumnDescriptor {
  return {
    header: formatHeader({ path }),
    kind: 'scalar',
    path,
    attribute,
    multiple: false,
    required: attribute.required === true,
    requiredInFile: isTopLevel(path) && attribute.required === true,
    readOnly: false,
    hint: hintForScalar(attribute),
  };
}

function hintForScalar(attribute: ScalarAttribute): string | undefined {
  switch (attribute.type) {
    case 'enumeration':
      return `One of: ${(attribute.enum ?? []).join(', ')}.`;
    case 'boolean':
      return 'true or false. 1, 0, yes and no are also accepted.';
    case 'date':
      return 'Date as YYYY-MM-DD.';
    case 'datetime':
      return 'Date and time in ISO 8601, for example 2026-01-31T09:00:00Z.';
    case 'time':
      return 'Time as HH:mm or HH:mm:ss.';
    case 'uid':
      return 'Unique slug. Generated from the source field when left blank.';
    case 'blocks':
      return 'JSON array in the Blocks editor format.';
    default:
      return undefined;
  }
}

function resolveRelationLookupKey(
  options: ResolvedOptions,
  targetUid: string,
  target: ContentTypeSchema
): string {
  const configured = options.relationLookupKeys[targetUid];
  if (configured && isUsableLookupKey(target, configured)) {
    return configured;
  }
  return DEFAULT_RELATION_LOOKUP_KEY;
}

/**
 * A lookup key has to identify at most one entry, so only `documentId` and attributes the schema
 * marks unique qualify. Anything else would make an import silently pick an arbitrary match.
 */
export function isUsableLookupKey(schema: ContentTypeSchema, key: string): boolean {
  if (key === DEFAULT_RELATION_LOOKUP_KEY) return true;

  const attribute = schema.attributes[key];
  if (!attribute) return false;
  if (isSensitiveAttribute(attribute)) return false;
  if (attribute.type === 'uid') return true;

  return attribute.unique === true;
}

export function listUsableLookupKeys(schema: ContentTypeSchema): string[] {
  const keys = [DEFAULT_RELATION_LOOKUP_KEY];

  for (const name of Object.keys(schema.attributes)) {
    if (name === DEFAULT_RELATION_LOOKUP_KEY) continue;
    if (isUsableLookupKey(schema, name)) keys.push(name);
  }

  return keys;
}

function pathOf(path: readonly ColumnSegment[]): string {
  return path.map((segment) => segment.field).join('.');
}

/** A single-segment path is an attribute of the content type itself, not of a component. */
function isTopLevel(path: readonly ColumnSegment[]): boolean {
  return path.length === 1 && path[0]?.index === undefined;
}

export function indexColumns(columns: readonly ColumnDescriptor[]): Map<string, ColumnDescriptor> {
  const map = new Map<string, ColumnDescriptor>();
  for (const column of columns) {
    map.set(column.header, column);
  }
  return map;
}
