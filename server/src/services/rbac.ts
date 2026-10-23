import type { Core } from '@strapi/strapi';
import { PLUGIN_NAME } from '../constants';
import type { ImportMode } from '../core/types';
import type { CollectionOperation } from '../permissions';
import type { CollectionConfig } from './settings';

const SUPER_ADMIN_CODE = 'strapi-super-admin';

export const CONTENT_MANAGER_ACTIONS = {
  read: 'plugin::content-manager.explorer.read',
  create: 'plugin::content-manager.explorer.create',
  update: 'plugin::content-manager.explorer.update',
  publish: 'plugin::content-manager.explorer.publish',
} as const;

export interface AdminRole {
  id?: number;
  code?: string;
}

export interface AdminUserLike {
  id?: number;
  email?: string;
  roles?: AdminRole[];
}

export interface UserAbilityLike {
  can(action: string, subject?: string, field?: string): boolean;
  cannot(action: string, subject?: string, field?: string): boolean;
}

export interface AccessContext {
  user?: AdminUserLike;
  userAbility?: UserAbilityLike;
}

export type AccessDecision =
  | { allowed: true }
  | { allowed: false; code: string; message: string };

export interface PermissionChecker {
  can: { read(): boolean; create(): boolean; update(): boolean; publish(): boolean };
  cannot: { read(): boolean; create(): boolean; update(): boolean; publish(): boolean };
  sanitizeOutput(data: unknown, options?: { action?: string }): Promise<unknown>;
  sanitizedQuery: {
    read(query: Record<string, unknown>): Promise<Record<string, unknown>>;
  };
}

const deny = (code: string, message: string): AccessDecision => ({ allowed: false, code, message });
const allow: AccessDecision = { allowed: true };

/** Which Content Manager rights an import needs, given the mode it will run in. */
export function contentManagerActionsForImport(mode: ImportMode): string[] {
  switch (mode) {
    case 'create-only':
    case 'skip-duplicates':
      return [CONTENT_MANAGER_ACTIONS.create];
    case 'update-only':
      return [CONTENT_MANAGER_ACTIONS.update];
    case 'upsert':
    default:
      return [CONTENT_MANAGER_ACTIONS.create, CONTENT_MANAGER_ACTIONS.update];
  }
}

export function isSuperAdmin(user: AdminUserLike | undefined): boolean {
  return (user?.roles ?? []).some((role) => role.code === SUPER_ADMIN_CODE);
}

export default ({ strapi }: { strapi: Core.Strapi }) => {
  /**
   * Builds the Content Manager's own permission checker for a model.
   *
   * `permission-checker` is an internal content-manager service rather than documented public
   * API, so a missing or changed service must not silently turn into "access granted". The
   * fallback asks the ability directly, and if even that is unavailable the caller denies.
   */
  function createChecker(uid: string, userAbility: UserAbilityLike): PermissionChecker | undefined {
    try {
      const checker = strapi
        .plugin('content-manager')
        .service('permission-checker')
        .create({ userAbility, model: uid });

      if (checker && typeof checker.can?.read === 'function') {
        return checker as PermissionChecker;
      }
    } catch (error) {
      strapi.log.warn(
        `[${PLUGIN_NAME}] content-manager permission-checker was unavailable; falling back to a direct ability check for ${uid}.`
      );
      strapi.log.debug(error instanceof Error ? error.message : String(error));
    }

    return undefined;
  }

  function abilityAllows(
    userAbility: UserAbilityLike,
    uid: string,
    actions: readonly string[]
  ): boolean {
    return actions.every((action) => userAbility.can(action, uid));
  }

  /**
   * Gate 3: the collection must be granted to at least one of the user's roles.
   *
   * A super admin is exempt. Strapi's model is that a super admin holds every permission, and
   * making this plugin the one place that can lock them out would also make the settings page
   * unreachable for the only account able to fix it.
   */
  function roleGrantAllows(
    user: AdminUserLike | undefined,
    uid: string,
    operation: CollectionOperation,
    roleGrants: Record<string, Record<string, { import: boolean; export: boolean }>>
  ): boolean {
    if (isSuperAdmin(user)) return true;

    const roles = user?.roles ?? [];
    if (roles.length === 0) return false;

    return roles.some((role) => {
      if (role.id === undefined) return false;
      const grant = roleGrants[String(role.id)]?.[uid];
      return grant?.[operation] === true;
    });
  }

  return {
    createChecker,
    isSuperAdmin,
    contentManagerActionsForImport,

    /**
     * Runs every gate for one operation on one collection. Called by the route policy and again
     * by the service that does the work, so a background job cannot outlive the permission that
     * started it.
     */
    async check(options: {
      uid: string;
      operation: CollectionOperation;
      mode?: ImportMode;
      context: AccessContext;
      collection: CollectionConfig;
      roleGrants: Record<string, Record<string, { import: boolean; export: boolean }>>;
      /** Set when the import will publish entries, which needs the publish right as well. */
      willPublish?: boolean;
    }): Promise<AccessDecision> {
      const { uid, operation, context, collection, roleGrants } = options;

      const schemaService = strapi.plugin(PLUGIN_NAME).service('schema');
      if (!schemaService.isUsableCollection(uid)) {
        return deny(
          'unknown_collection',
          `"${uid}" is not a collection type this plugin can work with.`
        );
      }

      if (!collection.enabled) {
        return deny(
          'collection_not_enabled',
          `"${uid}" has not been enabled for import or export. An administrator enables it in the plugin settings.`
        );
      }

      const operationEnabled =
        operation === 'import' ? collection.allowImport : collection.allowExport;
      if (!operationEnabled) {
        return deny('operation_not_enabled', `${operation} is switched off for "${uid}".`);
      }

      if (!roleGrantAllows(context.user, uid, operation, roleGrants)) {
        return deny(
          'role_not_granted',
          `Your role is not granted ${operation} access to "${uid}".`
        );
      }

      const { userAbility } = context;
      if (!userAbility) {
        return deny('no_ability', 'The request carried no admin permissions to check.');
      }

      const requiredActions =
        operation === 'export'
          ? [CONTENT_MANAGER_ACTIONS.read]
          : contentManagerActionsForImport(options.mode ?? 'upsert');

      if (options.willPublish) {
        requiredActions.push(CONTENT_MANAGER_ACTIONS.publish);
      }

      // Gate 4 keeps the plugin from becoming a way around the Content Manager. Someone who
      // cannot read a collection in the Content Manager must not be able to export it here,
      // whatever the plugin settings say.
      const checker = createChecker(uid, userAbility);
      const permitted = checker
        ? requiredActions.every((action) => {
            switch (action) {
              case CONTENT_MANAGER_ACTIONS.read:
                return checker.can.read();
              case CONTENT_MANAGER_ACTIONS.create:
                return checker.can.create();
              case CONTENT_MANAGER_ACTIONS.update:
                return checker.can.update();
              case CONTENT_MANAGER_ACTIONS.publish:
                return checker.can.publish();
              default:
                return false;
            }
          })
        : abilityAllows(userAbility, uid, requiredActions);

      if (!permitted) {
        return deny(
          'content_manager_denied',
          `Your role does not have the matching Content Manager rights on "${uid}".`
        );
      }

      return allow;
    },
  };
};
