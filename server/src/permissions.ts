import { PLUGIN_NAME } from './constants';

/**
 * Admin RBAC action ids.
 *
 * Two constraints shape these uids, and both are easy to break by "tidying" them.
 *
 * 1. Strapi validates every uid against `/^[a-z]([a-z|.|-]+)[a-z]$/`: lowercase letters, dots and
 *    hyphens only, no digits, and it must start and end with a letter.
 *
 * 2. The admin panel's `useRBAC` hook names each permission flag from the **last dot-separated
 *    segment** of the action id, hyphen-split and capitalised, prefixed with `can`. It ignores
 *    the keys of the permission map you pass it. So `config.read` and `job.read` would both
 *    become `canRead` and silently overwrite each other, which hides every control they guard.
 *
 * These uids are therefore single segments with hyphens, chosen so the derived flag is both
 * unique and self-describing. `server/tests/permissions.test.ts` enforces that.
 */
export const PLUGIN_ACTIONS = {
  configRead: `plugin::${PLUGIN_NAME}.read-config`,
  configUpdate: `plugin::${PLUGIN_NAME}.update-config`,
  templateDownload: `plugin::${PLUGIN_NAME}.download-template`,
  importRun: `plugin::${PLUGIN_NAME}.run-import`,
  exportRun: `plugin::${PLUGIN_NAME}.run-export`,
  jobRead: `plugin::${PLUGIN_NAME}.read-history`,
} as const;

export const permissionActionDefinitions = [
  {
    uid: 'read-config',
    displayName: 'View import and export configuration',
    pluginName: PLUGIN_NAME,
    section: 'plugins' as const,
    subCategory: 'import-export',
  },
  {
    uid: 'update-config',
    displayName: 'Change which collections and roles may import or export',
    pluginName: PLUGIN_NAME,
    section: 'plugins' as const,
    subCategory: 'import-export',
  },
  {
    uid: 'download-template',
    displayName: 'Download CSV templates',
    pluginName: PLUGIN_NAME,
    section: 'plugins' as const,
    subCategory: 'import-export',
  },
  {
    uid: 'run-import',
    displayName: 'Import CSV data — creates and updates entries in bulk',
    pluginName: PLUGIN_NAME,
    section: 'plugins' as const,
    subCategory: 'import-export',
  },
  {
    uid: 'run-export',
    displayName: 'Export collection data to CSV',
    pluginName: PLUGIN_NAME,
    section: 'plugins' as const,
    subCategory: 'import-export',
  },
  {
    uid: 'read-history',
    displayName: 'View import history and validation reports',
    pluginName: PLUGIN_NAME,
    section: 'plugins' as const,
    subCategory: 'import-export',
  },
];

export type CollectionOperation = 'import' | 'export';
