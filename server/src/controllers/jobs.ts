import { errors } from '@strapi/utils';
import type { Core } from '@strapi/strapi';
import { PLUGIN_NAME } from '../constants';
import type { AccessContext } from '../services/rbac';
import { DEFAULT_COLLECTION_CONFIG, type PluginSettings } from '../services/settings';
import type { JobRecord } from '../services/jobs';
import type { RequestContext } from '../types';

const MAX_PAGE_SIZE = 100;

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin(PLUGIN_NAME);

  /**
   * A job record describes what happened to a collection's data, so reading one needs the same
   * access as importing it. Holding `job.read` alone is not enough.
   */
  async function assertCanSeeJobsFor(ctx: RequestContext, uid: string): Promise<void> {
    const settings = (await plugin().service('settings').get()) as PluginSettings;
    const collection = settings.collections[uid] ?? { ...DEFAULT_COLLECTION_CONFIG };
    const state = ctx.state as AccessContext;

    const decision = await plugin().service('rbac').check({
      uid,
      operation: 'import',
      mode: settings.defaultImportMode,
      context: { user: state.user, userAbility: state.userAbility },
      collection,
      roleGrants: settings.roleGrants,
    });

    if (!decision.allowed) {
      // See `policies/collection-access.ts`: only a PolicyError keeps its message in the
      // response, and an administrator needs to know which gate refused them.
      throw new errors.PolicyError(decision.message, { code: decision.code });
    }
  }

  function positiveInt(raw: unknown, fallback: number, max: number): number {
    const value = Number(raw);
    if (!Number.isFinite(value) || value < 1) return fallback;

    return Math.min(Math.floor(value), max);
  }

  return {
    async list(ctx: RequestContext) {
      const uid = ctx.query.uid ? decodeURIComponent(String(ctx.query.uid)) : undefined;
      if (uid) await assertCanSeeJobsFor(ctx, uid);

      const page = positiveInt(ctx.query.page, 1, 10_000);
      const pageSize = positiveInt(ctx.query.pageSize, 20, MAX_PAGE_SIZE);

      const result = await plugin().service('jobs').list({ uid, page, pageSize });

      if (uid) {
        ctx.body = result;
        return;
      }

      // Without a uid filter the list could span collections the caller has no access to, so
      // each row is checked before it is returned.
      const visible: JobRecord[] = [];
      for (const job of result.results) {
        try {
          await assertCanSeeJobsFor(ctx, job.contentTypeUid);
          visible.push(job);
        } catch {
          continue;
        }
      }

      ctx.body = { ...result, results: visible, filtered: visible.length !== result.results.length };
    },

    async findOne(ctx: RequestContext) {
      const job = await plugin().service('jobs').findOne(String(ctx.params.jobId ?? ''));
      if (!job) throw new errors.NotFoundError('No such import job.');

      await assertCanSeeJobsFor(ctx, job.contentTypeUid);

      ctx.body = job;
    },

    async errorReport(ctx: RequestContext) {
      const jobs = plugin().service('jobs');
      const job = await jobs.findOne(String(ctx.params.jobId ?? ''));
      if (!job) throw new errors.NotFoundError('No such import job.');

      await assertCanSeeJobsFor(ctx, job.contentTypeUid);

      const settings = (await plugin().service('settings').get()) as PluginSettings;
      const file = jobs.buildErrorReport(job, settings);

      const safeAscii = file.fileName.replace(/[^A-Za-z0-9._-]/g, '_');
      ctx.set('Content-Type', 'text/csv; charset=utf-8');
      ctx.set('Content-Disposition', `attachment; filename="${safeAscii}"`);
      ctx.set('Cache-Control', 'no-store');
      ctx.set('X-Content-Type-Options', 'nosniff');
      ctx.set('Access-Control-Expose-Headers', 'Content-Disposition');

      ctx.body = file.content;
    },
  };
};
