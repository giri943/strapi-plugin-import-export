import { PassThrough } from 'node:stream';
import { errors } from '@strapi/utils';
import type { Core } from '@strapi/strapi';
import { JOB_KIND, PLUGIN_NAME } from '../constants';
import { CONTENT_MANAGER_ACTIONS, type AccessContext } from '../services/rbac';
import { DEFAULT_COLLECTION_CONFIG, type PluginSettings } from '../services/settings';
import type { ImportMode } from '../core/types';
import { parseExportFilters, relationFilterFields } from '../core/export-filters';
import { asHeaderList, parseColumnsParam, selectColumns } from '../core/select-columns';
import { inspectUpload, type UploadedFile } from '../utils/upload-guard';
import { discardStagedFile, stageUpload } from '../utils/temp-file';
import type { RequestContext } from '../types';
import type { ImportCounters } from '../services/import';

const IMPORT_MODES = ['create-only', 'update-only', 'upsert', 'skip-duplicates'] as const;
const MAX_SELECTED_DOCUMENTS = 1_000;

function asAttachment(ctx: RequestContext, fileName: string): void {
  // The quoted ASCII name keeps older browsers happy; filename* carries the real one.
  const safeAscii = fileName.replace(/[^A-Za-z0-9._-]/g, '_');

  ctx.set('Content-Type', 'text/csv; charset=utf-8');
  ctx.set(
    'Content-Disposition',
    `attachment; filename="${safeAscii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`
  );
  ctx.set('Cache-Control', 'no-store');
  // Without this a CSV served from the admin origin can still be sniffed as HTML and run.
  ctx.set('X-Content-Type-Options', 'nosniff');
  // Lets the admin panel read the filename back when it runs on a different origin to the API.
  ctx.set('Access-Control-Expose-Headers', 'Content-Disposition');
}

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const plugin = () => strapi.plugin(PLUGIN_NAME);

  async function contextFor(uid: string) {
    const settings = (await plugin().service('settings').get()) as PluginSettings;
    const collection = settings.collections[uid] ?? { ...DEFAULT_COLLECTION_CONFIG };
    const columns = plugin().service('schema').columnsFor(uid, settings, collection);

    return { settings, collection, columns };
  }

  function uidFrom(ctx: RequestContext): string {
    const uid = decodeURIComponent(String(ctx.params.uid ?? ''));
    if (uid.length === 0) throw new errors.ValidationError('A collection uid is required.');

    return uid;
  }

  function resolveMode(raw: unknown, fallback: ImportMode): ImportMode {
    if (raw === undefined || raw === null || raw === '') return fallback;

    const mode = String(raw);
    if (!(IMPORT_MODES as readonly string[]).includes(mode)) {
      throw new errors.ValidationError(`mode must be one of: ${IMPORT_MODES.join(', ')}.`);
    }

    return mode as ImportMode;
  }

  /**
   * Accepts the upload, records a job, and returns straight away.
   *
   * The work runs in the background because a 200,000-row file outlives any sensible request
   * timeout. The client follows the job record for progress and the final report.
   */
  async function startImport(ctx: RequestContext, dryRun: boolean) {
    const uid = uidFrom(ctx);
    const { settings, collection, columns } = await contextFor(uid);

    const jobs = plugin().service('jobs');

    if (await jobs.hasRunningJob(uid)) {
      throw new errors.ApplicationError(
        'An import for this collection is already running. Wait for it to finish before starting another.',
        { code: 'import_already_running' }
      );
    }

    const files = (ctx.request as { files?: Record<string, UploadedFile | UploadedFile[]> }).files;
    const candidate = files?.file ?? files?.csv;
    const uploaded = Array.isArray(candidate) ? candidate[0] : candidate;

    const inspection = await inspectUpload(uploaded, { maxFileSizeMb: settings.maxFileSizeMb });
    if (!inspection.ok) {
      throw new errors.ValidationError(inspection.message, { code: inspection.code });
    }

    const body = (ctx.request.body ?? {}) as Record<string, unknown>;
    const mode = resolveMode(body.mode, settings.defaultImportMode);
    const locale = typeof body.locale === 'string' && body.locale.length > 0 ? body.locale : undefined;

    const state = ctx.state as AccessContext;
    const checker = state.userAbility
      ? plugin().service('rbac').createChecker(uid, state.userAbility)
      : undefined;

    const canPublish = checker
      ? checker.can.publish()
      : (state.userAbility?.can(CONTENT_MANAGER_ACTIONS.publish, uid) ?? false);

    // Copied out of the request's own temp location so the file outlives the response and can
    // never be reached through the project's public directory.
    const stagedPath = await stageUpload(inspection.filePath);

    let job: { documentId: string };
    try {
      job = await jobs.create({
        uid,
        kind: dryRun ? JOB_KIND.dryRun : JOB_KIND.import,
        mode,
        fileName: inspection.fileName,
        fileSizeBytes: inspection.size,
        localeCode: locale,
        requestedById: state.user?.id,
        requestedByEmail: state.user?.email,
      });
    } catch (error) {
      await discardStagedFile(stagedPath);
      throw error;
    }

    const work = jobs.track(
      job.documentId,
      stagedPath,
      (reportProgress: (counters: ImportCounters) => Promise<void>) =>
        plugin().service('import').run({
          uid,
          filePath: stagedPath,
          columns,
          settings,
          collection,
          mode,
          dryRun,
          canPublish,
          defaultLocale: locale,
          onProgress: reportProgress,
        })
    );

    // `track` already writes the failure onto the job record, so this catch only stops an
    // unhandled rejection from reaching the process.
    work.catch(() => undefined);

    ctx.status = 202;
    ctx.body = {
      jobId: job.documentId,
      dryRun,
      mode,
      fileName: inspection.fileName,
      pollUrl: `/${PLUGIN_NAME}/jobs/${job.documentId}`,
    };
  }

  return {
    async columns(ctx: RequestContext) {
      const uid = uidFrom(ctx);
      const { settings, collection, columns } = await contextFor(uid);

      const schema = plugin().service('schema').getContentType(uid);

      ctx.body = {
        uid,
        columns,
        identifierField: collection.identifierField,
        /** The header the identifier lives in, so the UI can warn before it is deselected. */
        identifierHeader: collection.identifierField,
        allowImport: collection.allowImport,
        allowExport: collection.allowExport,
        defaultImportMode: settings.defaultImportMode,
        multiValueDelimiter: settings.multiValueDelimiter,
        csvDelimiter: settings.csvDelimiter,
        /** Top-level relation fields an export can be filtered on. */
        filterableRelations: [...relationFilterFields(columns)],
        filterableDates: [
          'createdAt',
          'updatedAt',
          ...(schema?.options?.draftAndPublish === true ? ['publishedAt'] : []),
        ],
        hasDraftAndPublish: schema?.options?.draftAndPublish === true,
        localized: schema?.pluginOptions?.i18n?.localized === true,
        limits: {
          maxFileSizeMb: settings.maxFileSizeMb,
          maxRows: settings.maxRows,
          maxColumns: settings.maxColumns,
        },
      };
    },

    async template(ctx: RequestContext) {
      const uid = uidFrom(ctx);
      const { settings, columns } = await contextFor(uid);

      const selection = selectColumns(columns, parseColumnsParam(ctx.query.columns));
      const wantsGuide = String(ctx.query.guide ?? '') === '1';

      const file = wantsGuide
        ? plugin().service('template').buildGuide(uid, selection.columns, settings)
        : plugin().service('template').buildTemplate(uid, selection.columns, settings);

      asAttachment(ctx, file.fileName);
      ctx.body = file.content;
    },

    /**
     * Values a relation filter can offer.
     *
     * Reading another collection's entries needs permission on *that* collection, not just on
     * the one being exported, so this checks the target before listing anything.
     */
    async relationOptions(ctx: RequestContext) {
      const uid = uidFrom(ctx);
      const field = String(ctx.query.field ?? '').trim();

      if (field.length === 0) {
        throw new errors.ValidationError('A relation field is required.');
      }

      const { settings, collection } = await contextFor(uid);
      const resolved = plugin().service('schema').describeRelationField(uid, field, settings, collection);

      if (!resolved) {
        throw new errors.ValidationError(
          `"${field}" is not a relation on this collection that can be filtered.`
        );
      }

      const state = ctx.state as AccessContext;
      const targetChecker = state.userAbility
        ? plugin().service('rbac').createChecker(resolved.targetUid, state.userAbility)
        : undefined;

      const canReadTarget = targetChecker
        ? targetChecker.can.read()
        : (state.userAbility?.can(CONTENT_MANAGER_ACTIONS.read, resolved.targetUid) ?? false);

      if (!canReadTarget) {
        throw new errors.PolicyError(
          `You cannot read ${resolved.targetUid}, so its values cannot be listed.`,
          { code: 'target_not_readable' }
        );
      }

      const search = String(ctx.query.q ?? '').trim();
      const pageSize = Math.min(Math.max(Number(ctx.query.pageSize) || 50, 1), 200);
      const page = Math.max(Number(ctx.query.page) || 1, 1);

      const result = await plugin().service('export').listRelationOptions({
        targetUid: resolved.targetUid,
        labelKey: resolved.labelKey,
        search,
        page,
        pageSize,
        checker: targetChecker,
      });

      ctx.body = {
        field,
        targetUid: resolved.targetUid,
        labelKey: resolved.labelKey,
        ...result,
      };
    },

    async export(ctx: RequestContext) {
      const uid = uidFrom(ctx);
      const { settings, collection, columns } = await contextFor(uid);
      const body = (ctx.request.body ?? {}) as Record<string, unknown>;

      const state = ctx.state as AccessContext;
      const checker = state.userAbility
        ? plugin().service('rbac').createChecker(uid, state.userAbility)
        : undefined;

      const documentIds = Array.isArray(body.documentIds)
        ? body.documentIds
            .filter((value): value is string => typeof value === 'string')
            .slice(0, MAX_SELECTED_DOCUMENTS)
        : undefined;

      const schema = plugin().service('schema').getContentType(uid);
      const parsedFilters = parseExportFilters(columns, body, {
        hasDraftAndPublish: schema?.options?.draftAndPublish === true,
      });
      if (!parsedFilters.ok) {
        throw new errors.ValidationError(parsedFilters.message, { code: parsedFilters.code });
      }

      const selection = selectColumns(columns, asHeaderList(body.columns));

      const exportService = plugin().service('export');

      asAttachment(ctx, exportService.fileNameFor(uid));

      // Koa pipes a stream body for us, which keeps the response flowing while pages are still
      // being fetched instead of buffering the whole export in memory first.
      const output = new PassThrough();
      ctx.body = output;

      exportService
        .streamTo(
          {
            uid,
            columns: selection.columns,
            settings,
            collection,
            checker,
            status: body.status === 'published' ? 'published' : 'draft',
            locale: typeof body.locale === 'string' ? body.locale : undefined,
            documentIds,
            relationFilters: parsedFilters.relations,
            dateFilters: parsedFilters.dates,
          },
          output
        )
        .catch((error: unknown) => {
          // The headers are already on the wire, so the only honest signal left is to break the
          // stream. The client sees a truncated download rather than a silently short file.
          strapi.log.error(
            `[${PLUGIN_NAME}] Export of ${uid} failed mid-stream: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
          output.destroy(error instanceof Error ? error : new Error('Export failed.'));
        });
    },

    dryRun(ctx: RequestContext) {
      return startImport(ctx, true);
    },

    import(ctx: RequestContext) {
      return startImport(ctx, false);
    },
  };
};
