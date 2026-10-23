import type { Core } from '@strapi/strapi';
import { PLUGIN_NAME, SETTINGS_STORE_KEY } from '../constants';
import { SETTING_BOUNDS } from '../config';
import { isSupportedDelimiter, type CsvDelimiter } from '../core/csv';
import {
  DEFAULT_MEDIA_LOOKUP_KEY,
  DEFAULT_RELATION_LOOKUP_KEY,
  SUPPORTED_MEDIA_LOOKUP_KEYS,
} from '../core/schema';
import type { ImportMode } from '../core/types';

export type MediaLookupKey = (typeof SUPPORTED_MEDIA_LOOKUP_KEYS)[number];

export interface CollectionConfig {
  enabled: boolean;
  allowImport: boolean;
  allowExport: boolean;
  /** Field paths excluded from templates, exports and imports for this collection. */
  excludeFields: string[];
  /** Target content-type uid to the attribute used for matching, e.g. `api::tag.tag` to `slug`. */
  relationLookupKeys: Record<string, string>;
  /** Column used to decide whether a row updates an existing entry. */
  identifierField: string;
}

export interface CollectionGrant {
  import: boolean;
  export: boolean;
}

export interface PluginSettings {
  /** Keyed by content-type uid. Empty means nothing is exposed. */
  collections: Record<string, CollectionConfig>;
  /** Role id to content-type uid to the operations that role may run. */
  roleGrants: Record<string, Record<string, CollectionGrant>>;
  csvDelimiter: CsvDelimiter;
  multiValueDelimiter: string;
  escapeFormulas: boolean;
  includeBom: boolean;
  mediaLookupKey: MediaLookupKey;
  defaultImportMode: ImportMode;
  maxFileSizeMb: number;
  maxRows: number;
  maxColumns: number;
  maxCellLengthKb: number;
  batchSize: number;
  templateRepeatableSlots: number;
  maxComponentDepth: number;
  jobRetentionDays: number;
}

const IMPORT_MODES: readonly ImportMode[] = [
  'create-only',
  'update-only',
  'upsert',
  'skip-duplicates',
];

export const DEFAULT_COLLECTION_CONFIG: CollectionConfig = {
  enabled: false,
  allowImport: false,
  allowExport: false,
  excludeFields: [],
  relationLookupKeys: {},
  identifierField: DEFAULT_RELATION_LOOKUP_KEY,
};

function clampNumber(raw: unknown, bounds: { min: number; max: number; default: number }): number {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (Number.isNaN(value)) return bounds.default;

  return Math.min(bounds.max, Math.max(bounds.min, Math.round(value)));
}

function asBoolean(raw: unknown, fallback: boolean): boolean {
  return typeof raw === 'boolean' ? raw : fallback;
}

function asStringArray(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];

  return Array.from(
    new Set(
      raw
        .filter((entry): entry is string => typeof entry === 'string')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
    )
  );
}

function asLookupKeyMap(raw: unknown): Record<string, string> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};

  const out: Record<string, string> = {};
  for (const [uid, key] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key === 'string' && key.trim().length > 0) {
      out[uid] = key.trim();
    }
  }
  return out;
}

export function normaliseCollectionConfig(raw: unknown): CollectionConfig {
  if (typeof raw !== 'object' || raw === null) return { ...DEFAULT_COLLECTION_CONFIG };

  const input = raw as Partial<CollectionConfig>;
  const enabled = asBoolean(input.enabled, false);

  return {
    enabled,
    // An operation can never be allowed on a collection that is switched off. Keeping the two
    // flags independent would let a disabled row still answer "yes" to an import check.
    allowImport: enabled && asBoolean(input.allowImport, false),
    allowExport: enabled && asBoolean(input.allowExport, false),
    excludeFields: asStringArray(input.excludeFields),
    relationLookupKeys: asLookupKeyMap(input.relationLookupKeys),
    identifierField:
      typeof input.identifierField === 'string' && input.identifierField.trim().length > 0
        ? input.identifierField.trim()
        : DEFAULT_RELATION_LOOKUP_KEY,
  };
}

function normaliseCollections(raw: unknown): Record<string, CollectionConfig> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};

  const out: Record<string, CollectionConfig> = {};
  for (const [uid, config] of Object.entries(raw as Record<string, unknown>)) {
    out[uid] = normaliseCollectionConfig(config);
  }
  return out;
}

function normaliseRoleGrants(raw: unknown): Record<string, Record<string, CollectionGrant>> {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return {};

  const out: Record<string, Record<string, CollectionGrant>> = {};

  for (const [roleId, perCollection] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof perCollection !== 'object' || perCollection === null) continue;

    const grants: Record<string, CollectionGrant> = {};
    for (const [uid, grant] of Object.entries(perCollection as Record<string, unknown>)) {
      const input = (grant ?? {}) as Partial<CollectionGrant>;
      grants[uid] = {
        import: asBoolean(input.import, false),
        export: asBoolean(input.export, false),
      };
    }
    out[roleId] = grants;
  }

  return out;
}

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const getStore = () =>
    strapi.store({ type: 'plugin', name: PLUGIN_NAME, key: SETTINGS_STORE_KEY });

  const configDefaults = () =>
    (strapi.config.get(`plugin::${PLUGIN_NAME}`) ?? {}) as Record<string, unknown>;

  function resolve(
    stored: Partial<PluginSettings> | null,
    fromConfig: Record<string, unknown>
  ): PluginSettings {
    const csvDelimiter = (() => {
      const candidate = stored?.csvDelimiter ?? fromConfig.csvDelimiter ?? ',';
      return isSupportedDelimiter(String(candidate)) ? (String(candidate) as CsvDelimiter) : ',';
    })();

    const multiValueDelimiter = (() => {
      const candidate = String(stored?.multiValueDelimiter ?? fromConfig.multiValueDelimiter ?? ';');
      const usable =
        candidate.length === 1 &&
        candidate !== csvDelimiter &&
        !['"', '\\', '\n', '\r'].includes(candidate);
      // Falling back to a pipe rather than throwing keeps a bad stored value from breaking every
      // export; the settings endpoint rejects the clash before it can be written.
      return usable ? candidate : csvDelimiter === ';' ? '|' : ';';
    })();

    const mediaLookupKey = (() => {
      const candidate = String(stored?.mediaLookupKey ?? fromConfig.mediaLookupKey ?? DEFAULT_MEDIA_LOOKUP_KEY);
      return (SUPPORTED_MEDIA_LOOKUP_KEYS as readonly string[]).includes(candidate)
        ? (candidate as MediaLookupKey)
        : DEFAULT_MEDIA_LOOKUP_KEY;
    })();

    const defaultImportMode = (() => {
      const candidate = String(stored?.defaultImportMode ?? fromConfig.defaultImportMode ?? 'upsert');
      return (IMPORT_MODES as readonly string[]).includes(candidate)
        ? (candidate as ImportMode)
        : 'upsert';
    })();

    return {
      collections: normaliseCollections(stored?.collections),
      roleGrants: normaliseRoleGrants(stored?.roleGrants),
      csvDelimiter,
      multiValueDelimiter,
      escapeFormulas: asBoolean(
        stored?.escapeFormulas,
        asBoolean(fromConfig.escapeFormulas, true)
      ),
      includeBom: asBoolean(stored?.includeBom, asBoolean(fromConfig.includeBom, true)),
      mediaLookupKey,
      defaultImportMode,
      maxFileSizeMb: clampNumber(
        stored?.maxFileSizeMb ?? fromConfig.maxFileSizeMb,
        SETTING_BOUNDS.maxFileSizeMb
      ),
      maxRows: clampNumber(stored?.maxRows ?? fromConfig.maxRows, SETTING_BOUNDS.maxRows),
      maxColumns: clampNumber(
        stored?.maxColumns ?? fromConfig.maxColumns,
        SETTING_BOUNDS.maxColumns
      ),
      maxCellLengthKb: clampNumber(
        stored?.maxCellLengthKb ?? fromConfig.maxCellLengthKb,
        SETTING_BOUNDS.maxCellLengthKb
      ),
      batchSize: clampNumber(stored?.batchSize ?? fromConfig.batchSize, SETTING_BOUNDS.batchSize),
      templateRepeatableSlots: clampNumber(
        stored?.templateRepeatableSlots ?? fromConfig.templateRepeatableSlots,
        SETTING_BOUNDS.templateRepeatableSlots
      ),
      maxComponentDepth: clampNumber(
        stored?.maxComponentDepth ?? fromConfig.maxComponentDepth,
        SETTING_BOUNDS.maxComponentDepth
      ),
      jobRetentionDays: clampNumber(
        stored?.jobRetentionDays ?? fromConfig.jobRetentionDays,
        SETTING_BOUNDS.jobRetentionDays
      ),
    };
  }

  async function get(): Promise<PluginSettings> {
    const stored = (await getStore().get({})) as Partial<PluginSettings> | null;
    return resolve(stored, configDefaults());
  }

  return {
    get,

    async set(partial: Partial<PluginSettings>): Promise<PluginSettings> {
      const current = await get();
      const merged: Partial<PluginSettings> = {
        ...current,
        ...partial,
        collections:
          partial.collections !== undefined
            ? normaliseCollections(partial.collections)
            : current.collections,
        roleGrants:
          partial.roleGrants !== undefined
            ? normaliseRoleGrants(partial.roleGrants)
            : current.roleGrants,
      };

      const next = resolve(merged, configDefaults());
      await getStore().set({ value: next });

      return next;
    },

    /** Settings for one collection, or the locked-down default when it was never configured. */
    async forCollection(uid: string): Promise<CollectionConfig> {
      const settings = await get();
      return settings.collections[uid] ?? { ...DEFAULT_COLLECTION_CONFIG };
    },

    /**
     * Writes the store for the first time. The seed from `config/plugins` is applied only here,
     * so it cannot keep overriding an administrator's later changes on every boot.
     */
    async ensureDefaults(): Promise<void> {
      const existing = await getStore().get({});
      if (existing != null) return;

      const fromConfig = configDefaults();
      const seeded = resolve(
        { collections: normaliseCollections(fromConfig.seedCollections) },
        fromConfig
      );

      await getStore().set({ value: seeded });

      const seedCount = Object.keys(seeded.collections).length;
      if (seedCount > 0) {
        strapi.log.info(
          `[${PLUGIN_NAME}] Seeded ${seedCount} collection(s) from config/plugins on first run.`
        );
      }
    },
  };
};
