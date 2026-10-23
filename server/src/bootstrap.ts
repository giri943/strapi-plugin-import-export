import type { Core } from '@strapi/strapi';
import { PLUGIN_NAME } from './constants';
import type { PluginSettings } from './services/settings';
import { jobLogLine } from './utils/safe-log';

const bootstrap = async ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = strapi.plugin(PLUGIN_NAME);

  try {
    await plugin.service('settings').ensureDefaults();
  } catch (error) {
    strapi.log.error(
      `[${PLUGIN_NAME}] Could not write default settings. The plugin stays locked down until this is fixed.`,
      error
    );
  }

  const settings = (await plugin.service('settings').get()) as PluginSettings;
  const enabled = Object.values(settings.collections).filter((entry) => entry.enabled);

  if (enabled.length === 0) {
    strapi.log.info(
      `[${PLUGIN_NAME}] No collections are enabled yet. Enable them under Settings → CSV Import & Export.`
    );
  }

  const jobs = plugin.service('jobs');

  // A job still marked running at boot belonged to a process that is gone. It is marked
  // interrupted rather than resumed, because resuming without knowing the last written row
  // would duplicate entries.
  try {
    await jobs.sweepStaleJobs();
    const pruned = await jobs.pruneHistory(settings.jobRetentionDays);

    if (pruned > 0) {
      strapi.log.info(jobLogLine('jobs.pruned', { count: pruned, days: settings.jobRetentionDays }));
    }
  } catch (error) {
    strapi.log.debug(
      `[${PLUGIN_NAME}] Job housekeeping skipped on boot: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
};

export default bootstrap;
