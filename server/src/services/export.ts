import { stringify } from 'csv-stringify';
import { pipeline } from 'node:stream/promises';
import { Readable, type Writable } from 'node:stream';
import type { Core } from '@strapi/strapi';
import { PLUGIN_NAME } from '../constants';
import { UTF8_BOM } from '../core/csv';
import { buildPopulate } from '../core/populate';
import { renderRow } from '../core/render-row';
import { META_STATUS, hasDraftAndPublish, isLocalized } from '../core/schema';
import type { ColumnDescriptor } from '../core/types';
import { jobLogLine } from '../utils/safe-log';
import { createSchemaResolver } from '../utils/strapi-schema';
import type { PermissionChecker } from './rbac';
import type { CollectionConfig, PluginSettings } from './settings';

const PAGE_SIZE = 200;

export interface ExportRequest {
  uid: string;
  columns: readonly ColumnDescriptor[];
  settings: PluginSettings;
  collection: CollectionConfig;
  checker?: PermissionChecker;
  /** Export the draft or the published version. Ignored when draft & publish is off. */
  status?: 'draft' | 'published';
  locale?: string;
  /** documentIds to restrict the export to, used by the List View bulk action. */
  documentIds?: string[];
  filters?: Record<string, unknown>;
}

export interface ExportResult {
  rows: number;
  truncated: boolean;
}

export default ({ strapi }: { strapi: Core.Strapi }) => {
  function resolveStatus(uid: string, requested: ExportRequest['status']) {
    const schema = createSchemaResolver(strapi).getContentType(uid);
    if (!schema || !hasDraftAndPublish(schema)) return undefined;

    return requested === 'published' ? 'published' : 'draft';
  }

  function resolveLocale(uid: string, requested: string | undefined) {
    if (!requested) return undefined;

    const schema = createSchemaResolver(strapi).getContentType(uid);
    return schema && isLocalized(schema) ? requested : undefined;
  }

  async function buildQuery(request: ExportRequest) {
    const resolver = createSchemaResolver(strapi);

    const populate = buildPopulate(resolver, request.uid, {
      maxDepth: request.settings.maxComponentDepth,
      relationLookupKeys: request.collection.relationLookupKeys,
      excludeFields: request.collection.excludeFields,
    });

    const filters: Record<string, unknown> = { ...(request.filters ?? {}) };
    if (request.documentIds && request.documentIds.length > 0) {
      filters.documentId = { $in: request.documentIds };
    }

    const query: Record<string, unknown> = {
      populate,
      // A stable sort keeps offset paging from re-reading or skipping a row between pages.
      sort: 'id:asc',
      status: resolveStatus(request.uid, request.status),
      locale: resolveLocale(request.uid, request.locale),
      filters: Object.keys(filters).length > 0 ? filters : undefined,
    };

    if (!request.checker) return query;

    // `sanitizedQuery.read` folds the role's own conditions into the filters. Without it a role
    // restricted to its own entries could export the whole collection.
    const sanitized = await request.checker.sanitizedQuery.read(query);

    return { ...sanitized, populate, sort: 'id:asc' };
  }

  async function* iterateRows(request: ExportRequest): AsyncGenerator<string[]> {
    const query = await buildQuery(request);
    const documents = strapi.documents(request.uid as never);
    const renderOptions = {
      multiValueDelimiter: request.settings.multiValueDelimiter,
      escapeFormulas: request.settings.escapeFormulas,
    };
    const exportedStatus = resolveStatus(request.uid, request.status);

    let start = 0;
    let emitted = 0;

    for (;;) {
      const page = (await documents.findMany({
        ...(query as object),
        start,
        limit: PAGE_SIZE,
      } as never)) as unknown as Array<Record<string, unknown>>;

      if (!Array.isArray(page) || page.length === 0) return;

      for (const document of page) {
        if (emitted >= request.settings.maxRows) return;

        const visible = request.checker
          ? ((await request.checker.sanitizeOutput(document)) as Record<string, unknown>)
          : document;

        // The file is a snapshot of one version, so the status column states which version it is
        // rather than guessing at the other one.
        if (exportedStatus) {
          visible[META_STATUS] = exportedStatus;
        }

        yield renderRow(visible, request.columns, renderOptions);
        emitted += 1;
      }

      if (page.length < PAGE_SIZE) return;
      start += PAGE_SIZE;
    }
  }

  return {
    fileNameFor(uid: string): string {
      const base = uid.replace(/[^A-Za-z0-9._-]/g, '-');
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

      return `${base}-${stamp}.csv`;
    },

    /** Streams the export straight into the response. No full result set is ever buffered. */
    async streamTo(request: ExportRequest, destination: Writable): Promise<ExportResult> {
      const exportable = request.columns;
      const result: ExportResult = { rows: 0, truncated: false };

      const serialiser = stringify({
        delimiter: request.settings.csvDelimiter,
        record_delimiter: 'windows',
      });

      const source = Readable.from(
        (async function* generate() {
          yield exportable.map((column) => column.header);

          for await (const row of iterateRows({ ...request, columns: exportable })) {
            result.rows += 1;
            yield row;
          }

          result.truncated = result.rows >= request.settings.maxRows;
        })()
      );

      // Excel on Windows only detects UTF-8 when the file opens with a BOM. It goes to the
      // destination directly so the CSV serialiser never sees it as part of a cell.
      if (request.settings.includeBom) {
        destination.write(UTF8_BOM);
      }

      await pipeline(source, serialiser, destination);

      strapi.log.info(
        jobLogLine('export.completed', {
          uid: request.uid,
          rows: result.rows,
          columns: exportable.length,
          truncated: result.truncated,
        })
      );

      return result;
    },

    async countFor(request: ExportRequest): Promise<number> {
      const query = await buildQuery(request);
      const { populate: _populate, sort: _sort, ...countable } = query as Record<string, unknown>;

      try {
        return (await strapi
          .documents(request.uid as never)
          .count(countable as never)) as unknown as number;
      } catch (error) {
        strapi.log.debug(
          `[${PLUGIN_NAME}] Could not count ${request.uid} before export: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        return 0;
      }
    },
  };
};
