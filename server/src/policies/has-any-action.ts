import type { PluginPolicy } from '../types';

export interface HasAnyActionConfig {
  actions?: string[];
}

/**
 * Passes when the user holds at least one of the listed plugin actions.
 *
 * `admin::hasPermissions` requires every action in its list, which is wrong for a route that
 * several different roles legitimately reach — the column list is needed to export, to import
 * and to download a template.
 */
const hasAnyAction: PluginPolicy<HasAnyActionConfig> = (ctx, config) => {
  const actions = config?.actions ?? [];
  if (actions.length === 0) return false;

  const userAbility = ctx.state?.userAbility as { can(action: string): boolean } | undefined;
  if (!userAbility) return false;

  return actions.some((action) => userAbility.can(action));
};

export default hasAnyAction;
