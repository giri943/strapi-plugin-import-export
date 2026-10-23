import type { Core } from '@strapi/strapi';
import { PLUGIN_NAME } from './constants';
import { permissionActionDefinitions } from './permissions';

const register = ({ strapi }: { strapi: Core.Strapi }) => {
  try {
    strapi.service('admin::permission').actionProvider.registerMany(permissionActionDefinitions);
  } catch (error) {
    // Registration failing means the actions never appear under Settings → Roles, so nobody can
    // be granted them. Failing loudly here beats a silently unusable plugin.
    strapi.log.error(
      `[${PLUGIN_NAME}] Failed to register admin permission actions. Grant access via Roles only after fixing this error.`,
      error
    );
  }
};

export default register;
