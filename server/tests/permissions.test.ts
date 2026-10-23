import { describe, expect, it } from 'vitest';
import { PLUGIN_ACTIONS, permissionActionDefinitions } from '../src/permissions';
import { PLUGIN_NAME } from '../src/constants';

/** Strapi's own validator for plugin permission uids (`@strapi/admin` action-provider schema). */
const UID_PATTERN = /^[a-z]([a-z|.|-]+)[a-z]$/;

/**
 * Reimplements the admin panel's `getActionName` plus the `can` prefix from `useRBAC`.
 *
 * The admin panel derives each permission flag from the **last dot-separated segment** of the
 * action id, not from the keys of the permission map. Two actions ending in the same segment
 * collapse into one flag and silently hide every control they guard, which is exactly the bug
 * this file exists to prevent.
 */
function derivedFlag(actionId: string): string {
  const lastSegment = actionId.split('.').slice(-1)[0] ?? '';
  const name = lastSegment
    .split('-')
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');

  return `can${name}`;
}

describe('permission uids', () => {
  it('all pass Strapi admin validation', () => {
    for (const definition of permissionActionDefinitions) {
      expect(UID_PATTERN.test(definition.uid), `${definition.uid} must match ${UID_PATTERN}`).toBe(
        true
      );
    }
  });

  it('contain no digits, which Strapi rejects', () => {
    for (const definition of permissionActionDefinitions) {
      expect(/\d/.test(definition.uid), `${definition.uid} must not contain digits`).toBe(false);
    }
  });

  it('are unique', () => {
    const uids = permissionActionDefinitions.map((definition) => definition.uid);
    expect(new Set(uids).size).toBe(uids.length);
  });

  it('all declare the plugin name and the plugins section', () => {
    for (const definition of permissionActionDefinitions) {
      expect(definition.pluginName).toBe(PLUGIN_NAME);
      expect(definition.section).toBe('plugins');
    }
  });

  it('all carry a display name an administrator can act on', () => {
    for (const definition of permissionActionDefinitions) {
      expect(definition.displayName.length).toBeGreaterThan(10);
    }
  });

  it('cover exactly the actions the routes reference', () => {
    const fromDefinitions = permissionActionDefinitions
      .map((definition) => `plugin::${PLUGIN_NAME}.${definition.uid}`)
      .sort();
    const fromRoutes = Object.values(PLUGIN_ACTIONS).slice().sort();

    expect(fromDefinitions).toEqual(fromRoutes);
  });
});

describe('admin panel permission flags', () => {
  const flags = Object.values(PLUGIN_ACTIONS).map(derivedFlag);

  it('are unique, so no action silently overwrites another', () => {
    const duplicates = flags.filter((flag, index) => flags.indexOf(flag) !== index);

    expect(duplicates, `colliding flags: ${duplicates.join(', ')}`).toEqual([]);
  });

  /**
   * These are the exact names the admin components read. If this test fails, the admin panel has
   * stopped seeing a permission and the control it guards will never render.
   */
  it('match the names the admin components read', () => {
    expect(derivedFlag(PLUGIN_ACTIONS.configRead)).toBe('canReadConfig');
    expect(derivedFlag(PLUGIN_ACTIONS.configUpdate)).toBe('canUpdateConfig');
    expect(derivedFlag(PLUGIN_ACTIONS.templateDownload)).toBe('canDownloadTemplate');
    expect(derivedFlag(PLUGIN_ACTIONS.importRun)).toBe('canRunImport');
    expect(derivedFlag(PLUGIN_ACTIONS.exportRun)).toBe('canRunExport');
    expect(derivedFlag(PLUGIN_ACTIONS.jobRead)).toBe('canReadHistory');
  });

  it('are descriptive rather than a bare verb', () => {
    // `canRead` or `canRun` would be ambiguous across six actions and collide with each other.
    for (const flag of flags) {
      expect(flag.length, `${flag} is too generic`).toBeGreaterThan('canRead'.length);
    }
  });
});
