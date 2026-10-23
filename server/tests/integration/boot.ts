import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';

const PLAYGROUND = path.resolve(__dirname, '..', '..', '..', 'playground');

export const PLUGIN_NAME = 'strapi-import-export';
export const ARTICLE_UID = 'api::article.article';
export const AUTHOR_UID = 'api::author.author';
export const TAG_UID = 'api::tag.tag';

export interface BootedStrapi {
  strapi: any;
  plugin: () => any;
  databaseFile: string;
  stop: () => Promise<void>;
}

/**
 * Boots the playground app in-process against a throwaway SQLite file.
 *
 * This is the only place the plugin runs against a real database, a real Document Service and
 * real transactions. Everything the unit tests assert with a fake is re-checked here, because a
 * fake cannot tell us whether Strapi's own transaction wraps Document Service writes.
 */
export async function bootStrapi(): Promise<BootedStrapi> {
  // Kept inside the playground rather than in the OS temp directory: `config/database.js` joins
  // the name onto the app root, and on Windows a temp path on another drive cannot be expressed
  // as a relative path at all.
  const relativeName = path.join('.tmp', `it-${randomBytes(8).toString('hex')}.db`);
  const databaseFile = path.join(PLAYGROUND, relativeName);

  await fs.mkdir(path.dirname(databaseFile), { recursive: true });

  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_FILENAME: relativeName,
    APP_KEYS: 'integrationKeyOne,integrationKeyTwo',
    API_TOKEN_SALT: 'integration-api-token-salt',
    ADMIN_JWT_SECRET: 'integration-admin-jwt-secret',
    TRANSFER_TOKEN_SALT: 'integration-transfer-token-salt',
    STRAPI_DISABLE_UPDATE_NOTIFICATION: 'true',
    STRAPI_TELEMETRY_DISABLED: 'true',
    STRAPI_LOG_LEVEL: 'error',
  });

  const { createStrapi } = require('@strapi/strapi');

  const instance = await createStrapi({
    appDir: PLAYGROUND,
    distDir: PLAYGROUND,
  }).load();

  return {
    strapi: instance,
    plugin: () => instance.plugin(PLUGIN_NAME),
    databaseFile,
    async stop() {
      /**
       * `strapi.destroy()` ends with a bare `process.removeAllListeners()` (@strapi/core
       * `Strapi.js`), which also drops the IPC `message` handler the test runner's worker pool
       * installed. Node then has nothing keeping the forked worker alive, it exits, and the
       * parent fails with ERR_IPC_CHANNEL_CLOSED after an otherwise green run.
       *
       * Only the no-argument form is neutralised, and only for the duration of the shutdown, so
       * Strapi's own targeted `removeAllListeners(event)` calls still work.
       */
      const original = process.removeAllListeners.bind(process);
      process.removeAllListeners = ((event?: string) =>
        event === undefined ? process : original(event)) as typeof process.removeAllListeners;

      try {
        await instance.destroy();
      } finally {
        process.removeAllListeners = original;
        await fs.rm(databaseFile, { force: true, maxRetries: 5, retryDelay: 100 });
      }
    },
  };
}

export async function writeTempCsv(contents: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'import-export-it-csv-'));
  const target = path.join(directory, 'input.csv');

  await fs.writeFile(target, contents, 'utf8');

  return target;
}

export async function discardTempCsv(filePath: string): Promise<void> {
  await fs.rm(path.dirname(filePath), {
    recursive: true,
    force: true,
    maxRetries: 5,
    retryDelay: 50,
  });
}
