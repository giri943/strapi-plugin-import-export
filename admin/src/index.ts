import { Initializer } from './components/Initializer';
import { ListViewActions } from './components/ListViewActions';
import { PluginIcon } from './components/PluginIcon';
import pluginPermissions from './permissions';
import { PLUGIN_ID } from './pluginId';
import { getTranslation } from './utils/getTranslation';

export default {
  register(app: any) {
    app.addMenuLink({
      to: `plugins/${PLUGIN_ID}`,
      icon: PluginIcon,
      intlLabel: {
        id: getTranslation('plugin.name'),
        defaultMessage: 'CSV Import & Export',
      },
      permissions: pluginPermissions.readHistory,
      // Must not be an async function: Strapi checks for `AsyncFunction` and warns. It wants a
      // plain loader returning a dynamic import whose module has a `default`.
      Component: () => import('./pages/App').then((mod) => ({ default: mod.App })),
    });

    app.addSettingsLink(
      {
        id: PLUGIN_ID,
        intlLabel: { id: getTranslation('settings.section'), defaultMessage: 'CSV Import & Export' },
      },
      {
        id: `${PLUGIN_ID}-configuration`,
        to: `${PLUGIN_ID}/configuration`,
        intlLabel: { id: getTranslation('settings.title'), defaultMessage: 'Configuration' },
        permissions: pluginPermissions.readConfig,
        Component: () =>
          import('./pages/SettingsPage').then((mod) => ({ default: mod.SettingsPage })),
      }
    );

    app.registerPlugin({
      id: PLUGIN_ID,
      initializer: Initializer,
      isReady: false,
      name: PLUGIN_ID,
    });
  },

  bootstrap(app: any) {
    /**
     * `listView.actions` is the only Content Manager extension point that gives a
     * collection-level button in the List View. The typed Content Manager APIs cover document
     * actions and bulk actions, neither of which fits "act on this whole collection".
     */
    const contentManager = app.getPlugin('content-manager');
    if (!contentManager?.injectComponent) {
      // An older or patched Content Manager without this zone costs the buttons, not the plugin:
      // the settings page and the plugin's own page keep working.
      return;
    }

    contentManager.injectComponent('listView', 'actions', {
      name: `${PLUGIN_ID}-csv-actions`,
      Component: ListViewActions,
    });
  },

  async registerTrads({ locales }: { locales: string[] }) {
    return Promise.all(
      locales.map(async (locale) => {
        try {
          const { default: data } = await import(`./translations/${locale}.json`);
          return { data, locale };
        } catch {
          return { data: {}, locale };
        }
      })
    );
  },
};
