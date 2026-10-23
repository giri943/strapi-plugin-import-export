import { errors } from '@strapi/utils';
import { PLUGIN_NAME } from '../constants';
import type { ImportMode } from '../core/types';
import type { CollectionOperation } from '../permissions';
import { DEFAULT_COLLECTION_CONFIG, type PluginSettings } from '../services/settings';
import type { AccessContext, AccessDecision } from '../services/rbac';
import type { PluginPolicy } from '../types';

export interface CollectionAccessConfig {
  operation?: CollectionOperation;
}

/**
 * Enforces the collection allow-list, the per-role grant and the user's own Content Manager
 * rights before a handler runs.
 *
 * This is the gate that matters. The admin panel also hides buttons, but hiding a button is a
 * courtesy; this is the check that still applies when the endpoint is called directly.
 */
const collectionAccess: PluginPolicy<CollectionAccessConfig> = async (ctx, config, { strapi }) => {
  const operation = config?.operation;
  if (!operation) {
    strapi.log.error(
      `[${PLUGIN_NAME}] collection-access was mounted without an operation; denying the request.`
    );
    return false;
  }

  const uid = decodeURIComponent(String(ctx.params?.uid ?? ''));
  if (uid.length === 0) {
    throw new errors.ValidationError('A collection uid is required.');
  }

  const plugin = strapi.plugin(PLUGIN_NAME);
  const settings = (await plugin.service('settings').get()) as PluginSettings;
  const collection = settings.collections[uid] ?? { ...DEFAULT_COLLECTION_CONFIG };

  const state = ctx.state as AccessContext;
  const body = (ctx.request?.body ?? {}) as { mode?: string };

  const decision = (await plugin.service('rbac').check({
    uid,
    operation,
    mode: (body.mode as ImportMode | undefined) ?? settings.defaultImportMode,
    context: { user: state.user, userAbility: state.userAbility },
    collection,
    roleGrants: settings.roleGrants,
    // Publish rights are not demanded here. Whether any row publishes is only knowable once the
    // file is parsed, and requiring it up front would block an editor importing drafts. The
    // import service fails the individual rows that ask to publish without the right.
    willPublish: false,
  })) as AccessDecision;

  if (!decision.allowed) {
    /**
     * `PolicyError`, not `ForbiddenError`. Strapi's authorize middleware replaces a
     * `ForbiddenError` message with a bare "Forbidden" so an API cannot leak why it refused, and
     * treats `PolicyError` as the one exception whose message is published. Every caller here is
     * an authenticated administrator, and a refusal with no cause becomes a support ticket.
     */
    throw new errors.PolicyError(decision.message, { code: decision.code });
  }

  return true;
};

export default collectionAccess;
