const path = require('node:path');

/**
 * By default `resolve` points at the plugin package root rather than at `node_modules`, so the
 * playground exercises the build in this working tree without an install step. That is what the
 * integration tests use.
 *
 * The trade-off is that a plugin loaded from outside the app's `node_modules` resolves its own
 * copy of `@strapi/utils`, so the error classes it throws fail Strapi's `instanceof` checks and
 * every validation error surfaces as a 500 instead of a 400. Set
 * `IE_USE_INSTALLED_PLUGIN=true` after `npm install <tarball>` to load the installed copy and
 * see the real status codes.
 */
const useInstalled = process.env.IE_USE_INSTALLED_PLUGIN === 'true';

module.exports = () => ({
  'strapi-import-export': {
    enabled: true,
    ...(useInstalled ? {} : { resolve: path.resolve(__dirname, '..', '..') }),
    config: {
      /**
       * Applied once, only when the plugin store has never been written. After that the settings
       * page owns the allow-list, so this cannot keep overriding an operator's changes.
       */
      seedCollections: {
        'api::article.article': {
          enabled: true,
          allowImport: true,
          allowExport: true,
          identifierField: 'documentId',
          relationLookupKeys: {
            'api::author.author': 'email',
            'api::tag.tag': 'slug',
          },
        },
        'api::author.author': {
          enabled: true,
          allowImport: true,
          allowExport: true,
          identifierField: 'email',
        },
        'api::tag.tag': {
          enabled: true,
          allowImport: true,
          allowExport: true,
          identifierField: 'slug',
        },
      },
    },
  },
});
