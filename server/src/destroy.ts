import type { Core } from '@strapi/strapi';
import { PLUGIN_NAME } from './constants';
import { discardAllStagedFiles } from './utils/temp-file';

const destroy = async ({ strapi }: { strapi: Core.Strapi }) => {
  const removed = await discardAllStagedFiles();

  if (removed > 0) {
    strapi.log.debug(`[${PLUGIN_NAME}] Removed ${removed} staged upload director(ies) on shutdown.`);
  }
};

export default destroy;
