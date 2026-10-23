import { PLUGIN_ID } from './pluginId';

/**
 * Mirrors `server/src/permissions.ts`. The admin panel uses these to hide controls; the server
 * re-checks every one on the route, so a stale copy here can only hide a button, never grant
 * access.
 */
const pluginPermissions = {
  readConfig: [{ action: `plugin::${PLUGIN_ID}.read-config`, subject: null }],
  updateConfig: [{ action: `plugin::${PLUGIN_ID}.update-config`, subject: null }],
  downloadTemplate: [{ action: `plugin::${PLUGIN_ID}.download-template`, subject: null }],
  runImport: [{ action: `plugin::${PLUGIN_ID}.run-import`, subject: null }],
  runExport: [{ action: `plugin::${PLUGIN_ID}.run-export`, subject: null }],
  readHistory: [{ action: `plugin::${PLUGIN_ID}.read-history`, subject: null }],
};

/**
 * The flags `useRBAC` exposes for the permissions above.
 *
 * It derives each name from the last dot-separated segment of the action id, not from the keys
 * of this map: `plugin::…​.read-config` becomes `canReadConfig`. Reading them through this object
 * keeps the guesswork in one place, so a renamed action fails to compile instead of quietly
 * turning a control off.
 */
export const RBAC_FLAGS = {
  readConfig: 'canReadConfig',
  updateConfig: 'canUpdateConfig',
  downloadTemplate: 'canDownloadTemplate',
  runImport: 'canRunImport',
  runExport: 'canRunExport',
  readHistory: 'canReadHistory',
} as const;

export type AllowedActions = Partial<Record<(typeof RBAC_FLAGS)[keyof typeof RBAC_FLAGS], boolean>>;

export default pluginPermissions;
