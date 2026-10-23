import { randomUUID } from 'node:crypto';
import { stringify } from 'csv-stringify/sync';
import type { Core } from '@strapi/strapi';
import {
  IMPORT_JOB_UID,
  JOB_HEARTBEAT_INTERVAL_MS,
  JOB_KIND,
  JOB_STALE_AFTER_MS,
  JOB_STATUS,
  PLUGIN_NAME,
  type JobKind,
  type JobStatus,
} from '../constants';
import { AMBIGUOUS_FIELD_CHARS, UTF8_BOM } from '../core/csv';
import type { ImportMode, RowError } from '../core/types';
import { jobLogLine } from '../utils/safe-log';
import { discardStagedFile } from '../utils/temp-file';
import type { ImportCounters, ImportOutcome } from './import';
import type { PluginSettings } from './settings';

/** Identifies this process, so a job started here is never picked up by another instance. */
const INSTANCE_ID = `${process.pid}-${randomUUID().slice(0, 8)}`;

export interface JobRecord {
  documentId: string;
  contentTypeUid: string;
  jobKind: JobKind;
  jobStatus: JobStatus;
  importMode: ImportMode;
  fileName?: string;
  totalRows?: number;
  processedRows?: number;
  createdCount?: number;
  updatedCount?: number;
  skippedCount?: number;
  failedCount?: number;
  rowErrors?: RowError[];
  errorsTruncated?: boolean;
  report?: Record<string, unknown>;
  failureMessage?: string;
  startedAt?: string;
  finishedAt?: string;
  requestedById?: number;
  requestedByEmail?: string;
  claimedBy?: string;
  heartbeatAt?: string;
}

export interface CreateJobInput {
  uid: string;
  kind: JobKind;
  mode: ImportMode;
  fileName: string;
  fileSizeBytes: number;
  localeCode?: string;
  requestedById?: number;
  requestedByEmail?: string;
}

export default ({ strapi }: { strapi: Core.Strapi }) => {
  const documents = () => strapi.documents(IMPORT_JOB_UID as never);

  async function create(input: CreateJobInput): Promise<JobRecord> {
    const now = new Date().toISOString();

    const created = (await documents().create({
      data: {
        contentTypeUid: input.uid,
        jobKind: input.kind,
        jobStatus: JOB_STATUS.running,
        importMode: input.mode,
        fileName: input.fileName,
        fileSizeBytes: String(input.fileSizeBytes),
        localeCode: input.localeCode,
        totalRows: 0,
        processedRows: 0,
        createdCount: 0,
        updatedCount: 0,
        skippedCount: 0,
        failedCount: 0,
        requestedById: input.requestedById,
        requestedByEmail: input.requestedByEmail,
        // Claimed by this process at creation time. The uploaded file lives on this machine's
        // temp disk, so no other instance could run the job even if it wanted to.
        claimedBy: INSTANCE_ID,
        startedAt: now,
        heartbeatAt: now,
      } as never,
    } as never)) as unknown as JobRecord;

    return created;
  }

  async function patch(documentId: string, data: Record<string, unknown>): Promise<void> {
    try {
      await documents().update({ documentId, data: data as never } as never);
    } catch (error) {
      // Losing a progress update must never abort the import it is reporting on.
      strapi.log.debug(
        `[${PLUGIN_NAME}] Could not update job ${documentId}: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  return {
    instanceId: INSTANCE_ID,
    create,

    heartbeat(documentId: string) {
      return patch(documentId, { heartbeatAt: new Date().toISOString() });
    },

    progress(documentId: string, counters: ImportCounters) {
      return patch(documentId, {
        totalRows: counters.totalRows,
        processedRows: counters.processedRows,
        createdCount: counters.created,
        updatedCount: counters.updated,
        skippedCount: counters.skipped,
        failedCount: counters.failed,
        heartbeatAt: new Date().toISOString(),
      });
    },

    async finish(documentId: string, outcome: ImportOutcome): Promise<void> {
      await patch(documentId, {
        jobStatus: outcome.aborted ? JOB_STATUS.failed : JOB_STATUS.completed,
        totalRows: outcome.counters.totalRows,
        processedRows: outcome.counters.processedRows,
        createdCount: outcome.counters.created,
        updatedCount: outcome.counters.updated,
        skippedCount: outcome.counters.skipped,
        failedCount: outcome.counters.failed,
        rowErrors: outcome.errors,
        errorsTruncated: outcome.errorsTruncated,
        report: { header: outcome.header, aborted: outcome.aborted ?? null },
        failureMessage: outcome.aborted?.message,
        finishedAt: new Date().toISOString(),
      });
    },

    async fail(documentId: string, message: string): Promise<void> {
      await patch(documentId, {
        jobStatus: JOB_STATUS.failed,
        failureMessage: message,
        finishedAt: new Date().toISOString(),
      });
    },

    /**
     * Runs an import while keeping the job record current, and makes sure the staged upload is
     * deleted whichever way the run ends.
     */
    async track<T extends ImportOutcome>(
      documentId: string,
      filePath: string,
      work: (reportProgress: (counters: ImportCounters) => Promise<void>) => Promise<T>
    ): Promise<T> {
      const beat = setInterval(() => {
        void this.heartbeat(documentId);
      }, JOB_HEARTBEAT_INTERVAL_MS);

      try {
        const outcome = await work((counters) => this.progress(documentId, counters));
        await this.finish(documentId, outcome);
        return outcome;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'The import failed.';
        await this.fail(documentId, message);
        throw error;
      } finally {
        clearInterval(beat);
        await discardStagedFile(filePath);
      }
    },

    async findOne(documentId: string): Promise<JobRecord | null> {
      return (await documents().findOne({ documentId } as never)) as unknown as JobRecord | null;
    },

    /**
     * Guards against a second import piling onto the same collection.
     *
     * Two concurrent runs over the same rows would fight for locks and could interleave a create
     * and an update of the same entry, so the second caller is turned away instead.
     */
    async hasRunningJob(uid: string): Promise<boolean> {
      const fresh = new Date(Date.now() - JOB_STALE_AFTER_MS).toISOString();

      try {
        const count = (await documents().count({
          filters: {
            contentTypeUid: uid,
            jobStatus: { $in: [JOB_STATUS.queued, JOB_STATUS.running] },
            heartbeatAt: { $gte: fresh },
          },
        } as never)) as unknown as number;

        return (count ?? 0) > 0;
      } catch (error) {
        // Failing open here is deliberate: a broken count must not make imports impossible.
        strapi.log.debug(
          `[${PLUGIN_NAME}] Could not check for a running job on ${uid}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return false;
      }
    },

    async list(options: { uid?: string; page: number; pageSize: number }) {
      const filters = options.uid ? { contentTypeUid: options.uid } : undefined;

      const [rows, total] = await Promise.all([
        documents().findMany({
          filters,
          sort: 'createdAt:desc',
          start: (options.page - 1) * options.pageSize,
          limit: options.pageSize,
          // The row errors can be thousands of entries; the list view does not need them.
          fields: [
            'contentTypeUid',
            'jobKind',
            'jobStatus',
            'importMode',
            'fileName',
            'totalRows',
            'processedRows',
            'createdCount',
            'updatedCount',
            'skippedCount',
            'failedCount',
            'failureMessage',
            'startedAt',
            'finishedAt',
            'requestedByEmail',
            'createdAt',
          ],
        } as never) as unknown as Promise<JobRecord[]>,
        documents().count({ filters } as never) as unknown as Promise<number>,
      ]);

      return { results: rows ?? [], total: total ?? 0, page: options.page, pageSize: options.pageSize };
    },

    /** Renders a job's validation errors as a CSV an operator can work through row by row. */
    buildErrorReport(job: JobRecord, settings: PluginSettings): { fileName: string; content: string } {
      const rows: string[][] = [['line', 'column', 'code', 'message']];

      for (const error of job.rowErrors ?? []) {
        rows.push([String(error.line), error.column ?? '', error.code, error.message]);
      }

      if (job.errorsTruncated) {
        rows.push([
          '',
          '',
          'truncated',
          `Only the first ${rows.length - 1} errors were kept. Fix these and run the file again.`,
        ]);
      }

      const content = stringify(rows, {
        delimiter: settings.csvDelimiter,
        record_delimiter: 'windows',
        quoted_match: AMBIGUOUS_FIELD_CHARS,
      });

      const base = job.contentTypeUid.replace(/[^A-Za-z0-9._-]/g, '-');

      return {
        fileName: `${base}-import-errors.csv`,
        content: settings.includeBom ? `${UTF8_BOM}${content}` : content,
      };
    },

    /**
     * Marks jobs whose process died as interrupted.
     *
     * They are never resumed automatically: without knowing which row was the last one written,
     * a resume would duplicate entries. An operator re-runs the file, and upsert mode makes that
     * safe.
     */
    async sweepStaleJobs(): Promise<number> {
      const cutoff = new Date(Date.now() - JOB_STALE_AFTER_MS).toISOString();

      try {
        const stale = (await documents().findMany({
          filters: {
            jobStatus: { $in: [JOB_STATUS.queued, JOB_STATUS.running] },
            $or: [{ heartbeatAt: { $lt: cutoff } }, { heartbeatAt: { $null: true } }],
          },
          fields: ['contentTypeUid', 'claimedBy', 'heartbeatAt'],
          limit: 500,
        } as never)) as unknown as JobRecord[];

        for (const job of stale ?? []) {
          await patch(job.documentId, {
            jobStatus: JOB_STATUS.interrupted,
            failureMessage:
              'The process running this import stopped before it finished. Re-run the file; upsert mode will skip the rows that already landed.',
            finishedAt: new Date().toISOString(),
          });
        }

        const count = stale?.length ?? 0;
        if (count > 0) {
          strapi.log.warn(jobLogLine('jobs.swept-stale', { count }));
        }

        return count;
      } catch (error) {
        strapi.log.debug(
          `[${PLUGIN_NAME}] Stale job sweep did not run: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return 0;
      }
    },

    /** Deletes job history past the retention window so the table cannot grow without bound. */
    async pruneHistory(retentionDays: number): Promise<number> {
      const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

      try {
        const old = (await documents().findMany({
          filters: {
            createdAt: { $lt: cutoff },
            jobStatus: { $in: [JOB_STATUS.completed, JOB_STATUS.failed, JOB_STATUS.interrupted] },
          },
          fields: ['contentTypeUid'],
          limit: 1_000,
        } as never)) as unknown as JobRecord[];

        for (const job of old ?? []) {
          await documents().delete({ documentId: job.documentId } as never);
        }

        return old?.length ?? 0;
      } catch (error) {
        strapi.log.debug(
          `[${PLUGIN_NAME}] Job history prune did not run: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return 0;
      }
    },

    isDryRun(kind: JobKind): boolean {
      return kind === JOB_KIND.dryRun;
    },
  };
};
