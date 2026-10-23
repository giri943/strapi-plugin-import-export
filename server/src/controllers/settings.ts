import { errors } from '@strapi/utils';
import type { Core } from '@strapi/strapi';
import { BLOCKED_ATTRIBUTE_NAMES, PLUGIN_NAME } from '../constants';
import { SETTING_BOUNDS } from '../config';
import { SUPPORTED_DELIMITERS, isSupportedDelimiter } from '../core/csv';
import { SUPPORTED_MEDIA_LOOKUP_KEYS, isUsableLookupKey } from '../core/schema';
import {
  DEFAULT_COLLECTION_CONFIG,
  normaliseCollectionConfig,
  type PluginSettings,
} from '../services/settings';
import type { RequestContext } from '../types';

const IMPORT_MODES = ['create-only', 'update-only', 'upsert', 'skip-duplicates'] as const;

interface AdminRoleRow {
  id: number;
  name: string;
  code: string;
  description?: string;
}

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin(PLUGIN_NAME);

  /**
   * Rejects a lookup key that cannot identify a single entry.
   *
   * Accepting a non-unique key would make every import silently attach rows to whichever match
   * the database happened to return first.
   */
  function validateLookupKeys(uid: string, keys: Record<string, string>): void {
    const schemaService = plugin().service('schema');

    for (const [targetUid, key] of Object.entries(keys)) {
      const target = schemaService.getContentType(targetUid);
      if (!target) {
        throw new errors.ValidationError(`Unknown relation target "${targetUid}" on ${uid}.`);
      }
      if (!isUsableLookupKey(target, key)) {
        throw new errors.ValidationError(
          `"${key}" cannot identify a single ${targetUid} entry. Use documentId or a unique field.`
        );
      }
    }
  }

  function validateCollections(raw: unknown): Record<string, unknown> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new errors.ValidationError('collections must be an object keyed by content-type uid.');
    }

    const schemaService = plugin().service('schema');
    const out: Record<string, unknown> = {};

    for (const [uid, value] of Object.entries(raw as Record<string, unknown>)) {
      if (!schemaService.isUsableCollection(uid)) {
        throw new errors.ValidationError(
          `"${uid}" is not a collection type this plugin can expose.`
        );
      }

      const config = normaliseCollectionConfig(value);
      validateLookupKeys(uid, config.relationLookupKeys);

      const target = schemaService.getContentType(uid);
      if (target && !isUsableLookupKey(target, config.identifierField)) {
        throw new errors.ValidationError(
          `"${config.identifierField}" cannot be the identifier for ${uid}. Use documentId or a unique field.`
        );
      }

      out[uid] = config;
    }

    return out;
  }

  async function validateRoleGrants(raw: unknown): Promise<Record<string, unknown>> {
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
      throw new errors.ValidationError('roleGrants must be an object keyed by role id.');
    }

    const roles = (await strapi.db.query('admin::role').findMany({ select: ['id'] })) as Array<{
      id: number;
    }>;
    const knownRoleIds = new Set(roles.map((role) => String(role.id)));

    const out: Record<string, unknown> = {};
    for (const [roleId, grants] of Object.entries(raw as Record<string, unknown>)) {
      if (!knownRoleIds.has(roleId)) {
        throw new errors.ValidationError(`Unknown admin role id "${roleId}".`);
      }
      out[roleId] = grants;
    }

    return out;
  }

  return {
    async get(ctx: RequestContext) {
      const settings = (await plugin().service('settings').get()) as PluginSettings;
      const candidates = plugin().service('schema').listCandidates();

      const roles = (await strapi.db.query('admin::role').findMany({
        select: ['id', 'name', 'code', 'description'],
        orderBy: { id: 'asc' },
      })) as AdminRoleRow[];

      ctx.body = {
        settings,
        candidates,
        roles,
        limits: SETTING_BOUNDS,
        options: {
          delimiters: SUPPORTED_DELIMITERS,
          mediaLookupKeys: SUPPORTED_MEDIA_LOOKUP_KEYS,
          importModes: IMPORT_MODES,
          alwaysExcludedFields: BLOCKED_ATTRIBUTE_NAMES,
        },
        defaults: { collection: DEFAULT_COLLECTION_CONFIG },
      };
    },

    async update(ctx: RequestContext) {
      const body = (ctx.request.body ?? {}) as Record<string, unknown>;
      const patch: Record<string, unknown> = {};

      if (body.collections !== undefined) {
        patch.collections = validateCollections(body.collections);
      }
      if (body.roleGrants !== undefined) {
        patch.roleGrants = await validateRoleGrants(body.roleGrants);
      }

      if (body.csvDelimiter !== undefined) {
        const delimiter = String(body.csvDelimiter);
        if (!isSupportedDelimiter(delimiter)) {
          throw new errors.ValidationError('csvDelimiter must be a comma, semicolon, tab or pipe.');
        }
        patch.csvDelimiter = delimiter;
      }

      if (body.multiValueDelimiter !== undefined) {
        const delimiter = String(body.multiValueDelimiter);
        const csvDelimiter = String(patch.csvDelimiter ?? body.csvDelimiter ?? '');

        if (delimiter.length !== 1) {
          throw new errors.ValidationError('multiValueDelimiter must be a single character.');
        }
        if (['"', '\\', '\n', '\r'].includes(delimiter)) {
          throw new errors.ValidationError(
            'multiValueDelimiter may not be a quote, backslash or line break.'
          );
        }
        if (csvDelimiter.length > 0 && delimiter === csvDelimiter) {
          throw new errors.ValidationError(
            'multiValueDelimiter must differ from csvDelimiter, otherwise a list inside a cell cannot be told apart from a column break.'
          );
        }
        patch.multiValueDelimiter = delimiter;
      }

      if (body.mediaLookupKey !== undefined) {
        const key = String(body.mediaLookupKey);
        if (!(SUPPORTED_MEDIA_LOOKUP_KEYS as readonly string[]).includes(key)) {
          throw new errors.ValidationError(
            `mediaLookupKey must be one of: ${SUPPORTED_MEDIA_LOOKUP_KEYS.join(', ')}.`
          );
        }
        patch.mediaLookupKey = key;
      }

      if (body.defaultImportMode !== undefined) {
        const mode = String(body.defaultImportMode);
        if (!(IMPORT_MODES as readonly string[]).includes(mode)) {
          throw new errors.ValidationError(
            `defaultImportMode must be one of: ${IMPORT_MODES.join(', ')}.`
          );
        }
        patch.defaultImportMode = mode;
      }

      for (const flag of ['escapeFormulas', 'includeBom'] as const) {
        if (body[flag] !== undefined) patch[flag] = Boolean(body[flag]);
      }

      for (const [key, bounds] of Object.entries(SETTING_BOUNDS)) {
        if (body[key] === undefined) continue;

        const value = Number(body[key]);
        if (Number.isNaN(value) || value < bounds.min || value > bounds.max) {
          throw new errors.ValidationError(
            `${key} must be between ${bounds.min} and ${bounds.max}.`
          );
        }
        patch[key] = value;
      }

      const saved = await plugin().service('settings').set(patch);

      strapi.log.info(
        `[${PLUGIN_NAME}] Configuration updated by admin user ${
          (ctx.state as { user?: { id?: number } }).user?.id ?? 'unknown'
        }; ${Object.keys(saved.collections).length} collection(s) configured.`
      );

      ctx.body = { settings: saved };
    },

    /** Full column list for one collection, used by the settings page field picker. */
    async describe(ctx: RequestContext) {
      const uid = decodeURIComponent(String(ctx.params.uid ?? ''));
      const settings = (await plugin().service('settings').get()) as PluginSettings;
      const collection = settings.collections[uid] ?? DEFAULT_COLLECTION_CONFIG;

      const description = plugin().service('schema').describe(uid, settings, {
        ...collection,
        // The picker has to show every field, including the ones currently excluded, or an
        // administrator could never switch one back on.
        excludeFields: [],
      });

      if (!description) {
        throw new errors.NotFoundError(`"${uid}" is not a collection type this plugin can expose.`);
      }

      ctx.body = { ...description, config: collection };
    },
  };
};
