export type ScalarAttributeType =
  | 'string'
  | 'text'
  | 'richtext'
  | 'blocks'
  | 'email'
  | 'password'
  | 'uid'
  | 'date'
  | 'datetime'
  | 'time'
  | 'timestamp'
  | 'integer'
  | 'biginteger'
  | 'decimal'
  | 'float'
  | 'boolean'
  | 'enumeration'
  | 'json';

export type AttributeType = ScalarAttributeType | 'media' | 'relation' | 'component' | 'dynamiczone';

export type RelationKind =
  | 'oneToOne'
  | 'oneToMany'
  | 'manyToOne'
  | 'manyToMany'
  | 'morphToOne'
  | 'morphToMany'
  | 'morphOne'
  | 'morphMany';

export interface BaseAttribute {
  type: string;
  required?: boolean;
  unique?: boolean;
  private?: boolean;
  configurable?: boolean;
  writable?: boolean;
  default?: unknown;
  /** Present when the attribute is a custom field; `type` still holds the underlying scalar type. */
  customField?: string;
}

export interface ScalarAttribute extends BaseAttribute {
  type: ScalarAttributeType;
  minLength?: number;
  maxLength?: number;
  min?: number;
  max?: number;
  enum?: string[];
  targetField?: string;
  regex?: string;
}

export interface MediaAttribute extends BaseAttribute {
  type: 'media';
  multiple?: boolean;
  allowedTypes?: string[];
}

export interface RelationAttribute extends BaseAttribute {
  type: 'relation';
  relation: RelationKind;
  target?: string;
  inversedBy?: string;
  mappedBy?: string;
}

export interface ComponentAttribute extends BaseAttribute {
  type: 'component';
  component: string;
  repeatable?: boolean;
  min?: number;
  max?: number;
}

export interface DynamicZoneAttribute extends BaseAttribute {
  type: 'dynamiczone';
  components: string[];
}

export type StrapiAttribute =
  | ScalarAttribute
  | MediaAttribute
  | RelationAttribute
  | ComponentAttribute
  | DynamicZoneAttribute;

export interface SchemaInfo {
  displayName?: string;
  singularName?: string;
  pluralName?: string;
  description?: string;
}

export interface ContentTypeSchema {
  uid: string;
  kind?: 'collectionType' | 'singleType';
  modelType?: string;
  collectionName?: string;
  info?: SchemaInfo;
  options?: { draftAndPublish?: boolean; [key: string]: unknown };
  pluginOptions?: Record<string, Record<string, unknown>>;
  attributes: Record<string, StrapiAttribute>;
}

export interface ComponentSchema {
  uid: string;
  category?: string;
  info?: SchemaInfo;
  attributes: Record<string, StrapiAttribute>;
}

/**
 * Everything the column builder needs in order to resolve nested schemas, supplied by the caller
 * so the builder never reaches for a global `strapi` and stays unit-testable with plain fixtures.
 */
export interface SchemaResolver {
  getContentType(uid: string): ContentTypeSchema | undefined;
  getComponent(uid: string): ComponentSchema | undefined;
}

export type ColumnKind =
  | 'meta'
  | 'scalar'
  | 'json'
  | 'component'
  | 'relation'
  | 'media'
  | 'dynamiczone';

export interface ColumnSegment {
  field: string;
  /** Set only for a segment that addresses one entry of a repeatable component. */
  index?: number;
}

export interface ColumnDescriptor {
  /** Canonical header text. `formatHeader(parseHeader(h))` must return `h` for any valid header. */
  header: string;
  kind: ColumnKind;
  /** Root-to-leaf path through the schema. Empty for meta columns other than their own name. */
  path: ColumnSegment[];
  /** The attribute the leaf segment resolves to. Absent for meta columns. */
  attribute?: StrapiAttribute;
  /** Attribute name of the related content type used to match rows, e.g. `slug` in `author:slug`. */
  lookupKey?: string;
  /** Content-type uid for relations, `plugin::upload.file` for media. */
  targetUid?: string;
  /** True when the cell holds a delimited list rather than a single value. */
  multiple: boolean;
  /** The schema marks this attribute required. Checked per value, not per file. */
  required: boolean;
  /**
   * True when the file itself must carry this column.
   *
   * Only a required attribute at the top level qualifies. A required field inside a component is
   * required *of an entry that exists* — the component as a whole may be left out, so demanding
   * its columns would make every template with an optional component un-importable.
   */
  requiredInFile: boolean;
  /** Present in exports and templates but ignored on import. */
  readOnly: boolean;
  /**
   * True for the readable companion of a relation or media column. It sits next to the column
   * that actually identifies the entry and exists only so an export can be read by a person.
   */
  isLabel?: boolean;
  /** Short hint rendered in the admin column mapper and the template guide. */
  hint?: string;
}

export type ImportMode = 'create-only' | 'update-only' | 'upsert' | 'skip-duplicates';

export interface RowError {
  /** 1-based line number in the uploaded file, counting the header as line 1. */
  line: number;
  column?: string;
  code: string;
  message: string;
}
