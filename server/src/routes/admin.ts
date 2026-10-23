import { PLUGIN_NAME } from '../constants';
import { PLUGIN_ACTIONS } from '../permissions';

const adminAuth = ['admin::isAuthenticatedAdmin'] as const;

/** Requires every listed plugin action, the way Strapi's own policy does. */
const requireActions = (...actions: string[]) => [
  ...adminAuth,
  { name: 'admin::hasPermissions' as const, config: { actions } },
];

/** Requires at least one of the listed plugin actions. */
const requireAnyAction = (...actions: string[]) => [
  ...adminAuth,
  { name: `plugin::${PLUGIN_NAME}.has-any-action` as const, config: { actions } },
];

const collectionGate = (operation: 'import' | 'export') => ({
  name: `plugin::${PLUGIN_NAME}.collection-access` as const,
  config: { operation },
});

export default {
  type: 'admin' as const,
  routes: [
    {
      method: 'GET' as const,
      path: '/settings',
      handler: 'settings.get',
      config: { policies: requireActions(PLUGIN_ACTIONS.configRead) },
    },
    {
      method: 'PUT' as const,
      path: '/settings',
      handler: 'settings.update',
      config: { policies: requireActions(PLUGIN_ACTIONS.configUpdate) },
    },
    {
      method: 'GET' as const,
      path: '/settings/collections/:uid',
      handler: 'settings.describe',
      config: { policies: requireActions(PLUGIN_ACTIONS.configRead) },
    },

    {
      method: 'GET' as const,
      path: '/content/:uid/columns',
      handler: 'content.columns',
      config: {
        policies: [
          ...requireAnyAction(
            PLUGIN_ACTIONS.templateDownload,
            PLUGIN_ACTIONS.importRun,
            PLUGIN_ACTIONS.exportRun
          ),
          // Export is the weaker of the two gates, so a user who may only export still sees the
          // column list they need.
          collectionGate('export'),
        ],
      },
    },
    {
      method: 'GET' as const,
      path: '/content/:uid/template',
      handler: 'content.template',
      config: {
        policies: [
          ...requireActions(PLUGIN_ACTIONS.templateDownload),
          collectionGate('import'),
        ],
      },
    },
    {
      method: 'GET' as const,
      path: '/content/:uid/relation-options',
      handler: 'content.relationOptions',
      config: {
        policies: [...requireActions(PLUGIN_ACTIONS.exportRun), collectionGate('export')],
      },
    },
    {
      method: 'POST' as const,
      path: '/content/:uid/export',
      handler: 'content.export',
      config: {
        policies: [...requireActions(PLUGIN_ACTIONS.exportRun), collectionGate('export')],
      },
    },
    {
      method: 'POST' as const,
      path: '/content/:uid/import/dry-run',
      handler: 'content.dryRun',
      config: {
        policies: [...requireActions(PLUGIN_ACTIONS.importRun), collectionGate('import')],
      },
    },
    {
      method: 'POST' as const,
      path: '/content/:uid/import',
      handler: 'content.import',
      config: {
        policies: [...requireActions(PLUGIN_ACTIONS.importRun), collectionGate('import')],
      },
    },

    {
      method: 'GET' as const,
      path: '/jobs',
      handler: 'jobs.list',
      config: { policies: requireActions(PLUGIN_ACTIONS.jobRead) },
    },
    {
      method: 'GET' as const,
      path: '/jobs/:jobId',
      handler: 'jobs.findOne',
      config: { policies: requireActions(PLUGIN_ACTIONS.jobRead) },
    },
    {
      method: 'GET' as const,
      path: '/jobs/:jobId/errors',
      handler: 'jobs.errorReport',
      config: { policies: requireActions(PLUGIN_ACTIONS.jobRead) },
    },
  ],
};
