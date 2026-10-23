import { SUPPORTED_DELIMITERS } from '../core/csv';
import { SUPPORTED_MEDIA_LOOKUP_KEYS } from '../core/schema';

const IMPORT_MODES = ['create-only', 'update-only', 'upsert', 'skip-duplicates'];

export const SETTING_BOUNDS = {
  maxFileSizeMb: { min: 1, max: 512, default: 50 },
  maxRows: { min: 1, max: 1_000_000, default: 200_000 },
  maxColumns: { min: 1, max: 2_000, default: 200 },
  maxCellLengthKb: { min: 1, max: 1_024, default: 100 },
  batchSize: { min: 1, max: 500, default: 50 },
  templateRepeatableSlots: { min: 1, max: 20, default: 3 },
  maxComponentDepth: { min: 1, max: 5, default: 3 },
  jobRetentionDays: { min: 1, max: 365, default: 30 },
} as const;

/**
 * Only the scalar knobs are seeded from `config/plugins`. The collection allow-list and the role
 * grants live in the plugin store so an administrator can change them without a redeploy, and
 * they stay absent here on purpose: Strapi merges this object with lodash `defaultsDeep`, which
 * merges arrays by index, so a half-overridden list would silently widen access.
 */
export default {
  default: {
    csvDelimiter: ',',
    multiValueDelimiter: ';',
    escapeFormulas: true,
    includeBom: true,
    mediaLookupKey: 'name',
    defaultImportMode: 'upsert' as const,
    maxFileSizeMb: SETTING_BOUNDS.maxFileSizeMb.default,
    maxRows: SETTING_BOUNDS.maxRows.default,
    maxColumns: SETTING_BOUNDS.maxColumns.default,
    maxCellLengthKb: SETTING_BOUNDS.maxCellLengthKb.default,
    batchSize: SETTING_BOUNDS.batchSize.default,
    templateRepeatableSlots: SETTING_BOUNDS.templateRepeatableSlots.default,
    maxComponentDepth: SETTING_BOUNDS.maxComponentDepth.default,
    jobRetentionDays: SETTING_BOUNDS.jobRetentionDays.default,
    /**
     * Applied once, only when the store has never been written. Lets a team declare the
     * allow-list in code for a fresh environment without it fighting the admin UI afterwards.
     */
    seedCollections: {} as Record<string, unknown>,
  },

  validator(config: Record<string, unknown>) {
    if (config.csvDelimiter !== undefined) {
      if (!(SUPPORTED_DELIMITERS as readonly string[]).includes(String(config.csvDelimiter))) {
        throw new Error(
          `plugin config csvDelimiter must be one of: comma, semicolon, tab or pipe`
        );
      }
    }

    if (config.multiValueDelimiter !== undefined) {
      const delimiter = String(config.multiValueDelimiter);
      if (delimiter.length !== 1) {
        throw new Error('plugin config multiValueDelimiter must be a single character');
      }
      if (delimiter === '"' || delimiter === '\\' || delimiter === '\n' || delimiter === '\r') {
        throw new Error(
          'plugin config multiValueDelimiter may not be a quote, backslash or line break'
        );
      }
      const csvDelimiter = String(config.csvDelimiter ?? ',');
      if (delimiter === csvDelimiter) {
        throw new Error(
          'plugin config multiValueDelimiter must differ from csvDelimiter, otherwise a list inside a cell cannot be told apart from a column break'
        );
      }
    }

    if (
      config.mediaLookupKey !== undefined &&
      !(SUPPORTED_MEDIA_LOOKUP_KEYS as readonly string[]).includes(String(config.mediaLookupKey))
    ) {
      throw new Error(
        `plugin config mediaLookupKey must be one of: ${SUPPORTED_MEDIA_LOOKUP_KEYS.join(', ')}`
      );
    }

    if (
      config.defaultImportMode !== undefined &&
      !IMPORT_MODES.includes(String(config.defaultImportMode))
    ) {
      throw new Error(`plugin config defaultImportMode must be one of: ${IMPORT_MODES.join(', ')}`);
    }

    for (const [key, bounds] of Object.entries(SETTING_BOUNDS)) {
      const raw = config[key];
      if (raw === undefined) continue;

      const value = Number(raw);
      if (Number.isNaN(value) || value < bounds.min || value > bounds.max) {
        throw new Error(`plugin config ${key} must be between ${bounds.min} and ${bounds.max}`);
      }
    }

    if (config.seedCollections !== undefined) {
      if (
        typeof config.seedCollections !== 'object' ||
        config.seedCollections === null ||
        Array.isArray(config.seedCollections)
      ) {
        throw new Error('plugin config seedCollections must be an object keyed by content-type uid');
      }
    }
  },
};
