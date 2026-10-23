import { parse } from 'csv-parse';
import type { Core } from '@strapi/strapi';
import { MEDIA_UID } from '../constants';
import { coerceScalar, safeJsonParse } from '../core/coerce';
import { normaliseHeader, parseHeader, splitMultiValue, suggestColumn } from '../core/columns';
import {
  isSupportedDelimiter,
  sniffDelimiter,
  unescapeFormula,
  type CsvDelimiter,
} from '../core/csv';
import { compactComponentArrays, emptyRecord, setAtPath } from '../core/guards';
import {
  DEFAULT_RELATION_LOOKUP_KEY,
  META_DOCUMENT_ID,
  META_LOCALE,
  META_STATUS,
  hasDraftAndPublish,
  isLocalized,
} from '../core/schema';
import type {
  ColumnDescriptor,
  ColumnSegment,
  ImportMode,
  RowError,
  ScalarAttribute,
} from '../core/types';
import { jobLogLine, truncateForMessage } from '../utils/safe-log';
import { openCsvStream, readFirstLine } from '../utils/temp-file';
import { createSchemaResolver } from '../utils/strapi-schema';
import type { CollectionConfig, PluginSettings } from './settings';

export const MAX_STORED_ERRORS = 1_000;

export interface HeaderReport {
  delimiter: CsvDelimiter;
  recognised: string[];
  unknownColumns: Array<{ header: string; reason: string; suggestion?: string }>;
  duplicateColumns: string[];
  missingRequired: string[];
  readOnlyIgnored: string[];
  identifierColumn?: string;
}

export interface ImportCounters {
  totalRows: number;
  processedRows: number;
  created: number;
  updated: number;
  skipped: number;
  failed: number;
}

export interface ImportOutcome {
  header: HeaderReport;
  counters: ImportCounters;
  errors: RowError[];
  errorsTruncated: boolean;
  aborted?: { code: string; message: string };
}

export interface ImportRequest {
  uid: string;
  filePath: string;
  columns: readonly ColumnDescriptor[];
  settings: PluginSettings;
  collection: CollectionConfig;
  mode: ImportMode;
  /** When true nothing is written; the run only produces the validation report. */
  dryRun: boolean;
  defaultLocale?: string;
  /** False when the caller lacks the Content Manager publish right for this collection. */
  canPublish?: boolean;
  onProgress?: (counters: ImportCounters) => void | Promise<void>;
}

export interface PendingReference {
  header: string;
  path: ColumnSegment[];
  targetUid: string;
  lookupKey: string;
  values: string[];
  multiple: boolean;
  isMedia: boolean;
}

/** Exported because it appears in `planRow`'s inferred return type, which declaration emit needs. */
export interface RowPlan {
  line: number;
  payload: Record<string, unknown>;
  references: PendingReference[];
  identifierValue?: string;
  locale?: string;
  publish: boolean;
  errors: RowError[];
}

type ResolvedMap = Map<string, string | number | 'ambiguous'>;

export default ({ strapi }: { strapi: Core.Strapi }) => {
  function validateHeaders(
    rawHeaders: readonly string[],
    columns: readonly ColumnDescriptor[],
    collection: CollectionConfig,
    delimiter: CsvDelimiter
  ): { report: HeaderReport; mapping: Array<ColumnDescriptor | undefined> } {
    const byHeader = new Map(columns.map((column) => [column.header, column]));
    const knownHeaders = columns.map((column) => column.header);

    const report: HeaderReport = {
      delimiter,
      recognised: [],
      unknownColumns: [],
      duplicateColumns: [],
      missingRequired: [],
      readOnlyIgnored: [],
    };

    const mapping: Array<ColumnDescriptor | undefined> = [];
    const seen = new Set<string>();

    for (const raw of rawHeaders) {
      const header = normaliseHeader(raw);

      if (header.length === 0) {
        mapping.push(undefined);
        continue;
      }

      const parsed = parseHeader(header);
      if (!parsed.ok) {
        report.unknownColumns.push({ header, reason: parsed.message });
        mapping.push(undefined);
        continue;
      }

      const column = byHeader.get(header);
      if (!column) {
        report.unknownColumns.push({
          header,
          reason: 'No field in this collection matches this column.',
          suggestion: suggestColumn(header, knownHeaders),
        });
        mapping.push(undefined);
        continue;
      }

      if (seen.has(header)) {
        report.duplicateColumns.push(header);
        mapping.push(undefined);
        continue;
      }
      seen.add(header);

      if (column.readOnly) {
        report.readOnlyIgnored.push(header);
        mapping.push(undefined);
        continue;
      }

      report.recognised.push(header);
      mapping.push(column);
    }

    for (const column of columns) {
      if (column.readOnly || !column.requiredInFile) continue;
      if (!seen.has(column.header)) report.missingRequired.push(column.header);
    }

    const identifier = collection.identifierField || DEFAULT_RELATION_LOOKUP_KEY;
    if (seen.has(identifier)) {
      report.identifierColumn = identifier;
    }

    return { report, mapping };
  }

  function planRow(
    line: number,
    cells: readonly string[],
    mapping: readonly (ColumnDescriptor | undefined)[],
    request: ImportRequest,
    identifierColumn: string | undefined
  ): RowPlan {
    const plan: RowPlan = {
      line,
      payload: emptyRecord(),
      references: [],
      publish: false,
      errors: [],
    };

    const maxCellLength = request.settings.maxCellLengthKb * 1024;
    const presentEntries = findPresentEntries(cells, mapping);

    for (let index = 0; index < mapping.length; index += 1) {
      const column = mapping[index];
      if (!column) continue;

      // A component entry whose every cell is blank is an unused template slot. Skipping it means
      // its required fields are not demanded and the entry never reaches the payload.
      const entry = entryKeyOf(column);
      if (entry !== undefined && !presentEntries.has(entry)) continue;

      const rawCell = cells[index] ?? '';
      if (rawCell.length > maxCellLength) {
        plan.errors.push({
          line,
          column: column.header,
          code: 'cell_too_long',
          message: `Cell is ${rawCell.length} characters; the limit is ${maxCellLength}.`,
        });
        continue;
      }

      // An exported file may carry the apostrophe the exporter added to neutralise a formula.
      const cell = request.settings.escapeFormulas ? unescapeFormula(rawCell) : rawCell;

      if (column.kind === 'meta') {
        applyMetaColumn(plan, column, cell, request, identifierColumn);
        continue;
      }

      if (column.kind === 'relation' || column.kind === 'media') {
        const values = splitMultiValue(cell, request.settings.multiValueDelimiter);

        if (values.length === 0) {
          assign(plan, column.path, column.multiple ? [] : null);
          continue;
        }
        if (!column.multiple && values.length > 1) {
          plan.errors.push({
            line,
            column: column.header,
            code: 'too_many_references',
            message: `This field holds a single reference but ${values.length} were given.`,
          });
          continue;
        }

        plan.references.push({
          header: column.header,
          path: column.path,
          targetUid: column.targetUid ?? MEDIA_UID,
          lookupKey: column.lookupKey ?? DEFAULT_RELATION_LOOKUP_KEY,
          values,
          multiple: column.multiple,
          isMedia: column.kind === 'media',
        });
        continue;
      }

      if (column.kind === 'dynamiczone') {
        if (cell.trim().length === 0) {
          assign(plan, column.path, []);
          continue;
        }

        const parsed = safeJsonParse(cell);
        if (!parsed.ok) {
          plan.errors.push({
            line,
            column: column.header,
            code: parsed.code,
            message: parsed.message,
          });
          continue;
        }
        const zoneError = validateDynamicZone(parsed.value, column);
        if (zoneError) {
          plan.errors.push({ line, column: column.header, ...zoneError });
          continue;
        }

        assign(plan, column.path, parsed.value);
        continue;
      }

      const attribute = column.attribute as ScalarAttribute | undefined;
      if (!attribute) continue;

      const coerced = coerceScalar(cell, attribute);
      if (!coerced.ok) {
        plan.errors.push({
          line,
          column: column.header,
          code: coerced.code,
          message: truncateForMessage(coerced.message),
        });
        continue;
      }

      assign(plan, column.path, coerced.value);
    }

    plan.payload = compactComponentArrays(plan.payload) as Record<string, unknown>;

    return plan;
  }

  /**
   * Identifies the component entry a column belongs to, for example `faq[0]` for
   * `faq[0].question` and `seo` for `seo.metaTitle`. Top-level columns return undefined.
   */
  function entryKeyOf(column: ColumnDescriptor): string | undefined {
    if (column.path.length < 2) return undefined;

    return column.path
      .slice(0, -1)
      .map((segment) =>
        segment.index === undefined ? segment.field : `${segment.field}[${segment.index}]`
      )
      .join('.');
  }

  /** Component entries with at least one non-empty cell in this row. */
  function findPresentEntries(
    cells: readonly string[],
    mapping: readonly (ColumnDescriptor | undefined)[]
  ): Set<string> {
    const present = new Set<string>();

    for (let index = 0; index < mapping.length; index += 1) {
      const column = mapping[index];
      if (!column) continue;

      const entry = entryKeyOf(column);
      if (entry === undefined) continue;
      if ((cells[index] ?? '').trim().length === 0) continue;

      // A nested entry being filled implies its parents are in play too.
      const segments = entry.split('.');
      for (let depth = 1; depth <= segments.length; depth += 1) {
        present.add(segments.slice(0, depth).join('.'));
      }
    }

    return present;
  }

  function applyMetaColumn(
    plan: RowPlan,
    column: ColumnDescriptor,
    cell: string,
    request: ImportRequest,
    identifierColumn: string | undefined
  ): void {
    const value = cell.trim();

    if (column.header === META_DOCUMENT_ID) {
      if (value.length > 0 && identifierColumn === META_DOCUMENT_ID) {
        plan.identifierValue = value;
      }
      return;
    }

    if (column.header === META_LOCALE) {
      plan.locale = value.length > 0 ? value : request.defaultLocale;
      return;
    }

    if (column.header === META_STATUS) {
      if (value.length === 0 || value.toLowerCase() === 'draft') return;

      if (value.toLowerCase() === 'published') {
        if (request.canPublish === false) {
          plan.errors.push({
            line: plan.line,
            column: META_STATUS,
            code: 'publish_not_allowed',
            message:
              'This row asks to publish, but your role cannot publish in this collection. Set it to draft or ask for publish rights.',
          });
          return;
        }
        plan.publish = true;
        return;
      }

      plan.errors.push({
        line: plan.line,
        column: META_STATUS,
        code: 'invalid_status',
        message: `"${truncateForMessage(value)}" is not a status. Use draft or published.`,
      });
    }
  }

  function validateDynamicZone(
    value: unknown,
    column: ColumnDescriptor
  ): { code: string; message: string } | undefined {
    if (!Array.isArray(value)) {
      return {
        code: 'invalid_dynamiczone',
        message: 'A dynamic zone cell must hold a JSON array.',
      };
    }

    const allowed = new Set(
      ((column.attribute as { components?: string[] } | undefined)?.components ?? []) as string[]
    );

    for (const [index, entry] of value.entries()) {
      if (typeof entry !== 'object' || entry === null || Array.isArray(entry)) {
        return {
          code: 'invalid_dynamiczone',
          message: `Entry ${index} is not an object.`,
        };
      }

      const componentName = (entry as Record<string, unknown>).__component;
      if (typeof componentName !== 'string') {
        return {
          code: 'missing_component',
          message: `Entry ${index} has no "__component" key naming its component.`,
        };
      }
      if (!allowed.has(componentName)) {
        return {
          code: 'component_not_allowed',
          message: `Entry ${index} uses "${componentName}", which this dynamic zone does not allow. Allowed: ${[
            ...allowed,
          ].join(', ')}.`,
        };
      }
    }

    return undefined;
  }

  function assign(plan: RowPlan, path: readonly ColumnSegment[], value: unknown): void {
    try {
      setAtPath(plan.payload, [...path], value);
    } catch (error) {
      plan.errors.push({
        line: plan.line,
        code: 'unsafe_path',
        message: error instanceof Error ? error.message : 'Field path could not be written.',
      });
    }
  }

  /**
   * Resolves every relation and media reference in a batch with one query per target and key,
   * instead of one query per cell.
   */
  async function resolveReferences(plans: readonly RowPlan[]): Promise<Map<string, ResolvedMap>> {
    const wanted = new Map<
      string,
      { targetUid: string; lookupKey: string; isMedia: boolean; values: Set<string> }
    >();

    for (const plan of plans) {
      for (const reference of plan.references) {
        const key = `${reference.targetUid}::${reference.lookupKey}`;
        const bucket = wanted.get(key) ?? {
          targetUid: reference.targetUid,
          lookupKey: reference.lookupKey,
          isMedia: reference.isMedia,
          values: new Set<string>(),
        };

        for (const value of reference.values) bucket.values.add(value);
        wanted.set(key, bucket);
      }
    }

    const resolved = new Map<string, ResolvedMap>();

    for (const [key, bucket] of wanted) {
      resolved.set(
        key,
        bucket.isMedia
          ? await resolveMedia(bucket.lookupKey, [...bucket.values])
          : await resolveDocuments(bucket.targetUid, bucket.lookupKey, [...bucket.values])
      );
    }

    return resolved;
  }

  async function resolveDocuments(
    targetUid: string,
    lookupKey: string,
    values: readonly string[]
  ): Promise<ResolvedMap> {
    const out: ResolvedMap = new Map();
    if (values.length === 0) return out;

    const rows = (await strapi.documents(targetUid as never).findMany({
      filters: { [lookupKey]: { $in: values } },
      fields: [lookupKey, DEFAULT_RELATION_LOOKUP_KEY],
      status: 'draft',
      limit: values.length * 4,
    } as never)) as unknown as Array<Record<string, unknown>>;

    for (const row of rows ?? []) {
      const raw = row[lookupKey];
      if (raw === null || raw === undefined) continue;

      const value = String(raw);
      const documentId = String(row[DEFAULT_RELATION_LOOKUP_KEY]);
      const existing = out.get(value);

      // The same documentId appearing twice is i18n returning one row per locale, which is not
      // an ambiguity. Two different documents sharing the key is.
      if (existing !== undefined && existing !== documentId) {
        out.set(value, 'ambiguous');
        continue;
      }
      if (existing === undefined) out.set(value, documentId);
    }

    return out;
  }

  async function resolveMedia(lookupKey: string, values: readonly string[]): Promise<ResolvedMap> {
    const out: ResolvedMap = new Map();
    if (values.length === 0) return out;

    const needles =
      lookupKey === 'id'
        ? values.filter((value) => /^\d+$/.test(value)).map((value) => Number(value))
        : values;

    if (needles.length === 0) return out;

    const rows = (await strapi.db.query(MEDIA_UID).findMany({
      where: { [lookupKey]: { $in: needles } },
      select: ['id', lookupKey],
      limit: values.length * 4,
    })) as Array<Record<string, unknown>>;

    for (const row of rows ?? []) {
      const raw = row[lookupKey];
      if (raw === null || raw === undefined) continue;

      const value = String(raw);
      const id = Number(row.id);
      const existing = out.get(value);

      if (existing !== undefined && existing !== id) {
        out.set(value, 'ambiguous');
        continue;
      }
      if (existing === undefined) out.set(value, id);
    }

    return out;
  }

  /** Writes resolved references into each row's payload, failing rows whose targets are missing. */
  function applyReferences(plans: readonly RowPlan[], resolved: Map<string, ResolvedMap>): void {
    for (const plan of plans) {
      for (const reference of plan.references) {
        const lookup = resolved.get(`${reference.targetUid}::${reference.lookupKey}`);
        const ids: Array<string | number> = [];
        let failed = false;

        for (const value of reference.values) {
          const match = lookup?.get(value);

          if (match === undefined) {
            plan.errors.push({
              line: plan.line,
              column: reference.header,
              code: reference.isMedia ? 'media_not_found' : 'relation_not_found',
              message: reference.isMedia
                ? `No Media Library file has ${reference.lookupKey} "${truncateForMessage(value)}".`
                : `No ${reference.targetUid} entry has ${reference.lookupKey} "${truncateForMessage(
                    value
                  )}". Create it first, or correct the value.`,
            });
            failed = true;
            continue;
          }

          if (match === 'ambiguous') {
            plan.errors.push({
              line: plan.line,
              column: reference.header,
              code: 'reference_ambiguous',
              message: `More than one entry has ${reference.lookupKey} "${truncateForMessage(
                value
              )}". Use a unique key such as documentId.`,
            });
            failed = true;
            continue;
          }

          ids.push(match);
        }

        if (failed) continue;

        assign(plan, reference.path, reference.multiple ? ids : (ids[0] ?? null));
      }
    }
  }

  async function findExisting(
    uid: string,
    identifierColumn: string,
    plans: readonly RowPlan[]
  ): Promise<ResolvedMap> {
    const values = [
      ...new Set(
        plans
          .filter((plan) => plan.errors.length === 0 && plan.identifierValue !== undefined)
          .map((plan) => plan.identifierValue as string)
      ),
    ];

    if (values.length === 0) return new Map();

    return resolveDocuments(uid, identifierColumn, values);
  }

  type RowAction = 'create' | 'update' | 'skip';

  function decideAction(
    plan: RowPlan,
    existingDocumentId: string | 'ambiguous' | undefined,
    mode: ImportMode
  ): { action: RowAction; documentId?: string; error?: RowError } {
    if (existingDocumentId === 'ambiguous') {
      return {
        action: 'skip',
        error: {
          line: plan.line,
          code: 'identifier_ambiguous',
          message: 'More than one entry matches this identifier.',
        },
      };
    }

    const exists = existingDocumentId !== undefined;

    switch (mode) {
      case 'create-only':
        if (exists) {
          return {
            action: 'skip',
            error: {
              line: plan.line,
              code: 'duplicate',
              message: 'An entry with this identifier already exists and the mode is create-only.',
            },
          };
        }
        return { action: 'create' };

      case 'update-only':
        if (!exists) {
          return {
            action: 'skip',
            error: {
              line: plan.line,
              code: 'not_found',
              message: 'No entry matches this identifier and the mode is update-only.',
            },
          };
        }
        return { action: 'update', documentId: existingDocumentId };

      case 'skip-duplicates':
        return exists ? { action: 'skip' } : { action: 'create' };

      case 'upsert':
      default:
        return exists ? { action: 'update', documentId: existingDocumentId } : { action: 'create' };
    }
  }

  async function writeRow(
    uid: string,
    plan: RowPlan,
    action: RowAction,
    documentId: string | undefined,
    supportsDraftPublish: boolean,
    localized: boolean
  ): Promise<void> {
    const documents = strapi.documents(uid as never);
    const locale = localized ? plan.locale : undefined;

    if (action === 'create') {
      const created = (await documents.create({
        data: plan.payload as never,
        locale,
        status: supportsDraftPublish && plan.publish ? 'published' : undefined,
      } as never)) as unknown as Record<string, unknown>;

      void created;
      return;
    }

    if (action === 'update' && documentId) {
      await documents.update({
        documentId,
        data: plan.payload as never,
        locale,
      } as never);

      // `update` takes no status, so publishing an existing document is a second call. A row
      // marked draft deliberately leaves the published version alone rather than unpublishing it.
      if (supportsDraftPublish && plan.publish) {
        await (
          documents as unknown as {
            publish(params: Record<string, unknown>): Promise<unknown>;
          }
        ).publish({ documentId, locale });
      }
    }
  }

  return {
    validateHeaders,
    planRow,

    /**
     * Streams the file, validates every row, and when this is not a dry run commits the valid
     * rows in batches.
     *
     * Nothing is held in memory beyond one batch, so a 200,000-row file costs the same as a
     * 50-row one.
     */
    async run(request: ImportRequest): Promise<ImportOutcome> {
      const resolver = createSchemaResolver(strapi);
      const schema = resolver.getContentType(request.uid);
      const supportsDraftPublish = schema ? hasDraftAndPublish(schema) : false;
      const localized = schema ? isLocalized(schema) : false;

      // The configured delimiter is only a starting guess; a file saved by Excel in another
      // locale is accepted on its own terms rather than rejected as malformed.
      const sniffed = await readFirstLine(request.filePath);
      const fallback = isSupportedDelimiter(request.settings.csvDelimiter)
        ? request.settings.csvDelimiter
        : ',';
      const delimiter = sniffDelimiter(sniffed, fallback);

      const counters: ImportCounters = {
        totalRows: 0,
        processedRows: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        failed: 0,
      };
      const errors: RowError[] = [];
      let errorsTruncated = false;

      const recordError = (error: RowError) => {
        if (errors.length < MAX_STORED_ERRORS) {
          errors.push(error);
          return;
        }
        errorsTruncated = true;
      };

      let header: HeaderReport = {
        delimiter,
        recognised: [],
        unknownColumns: [],
        duplicateColumns: [],
        missingRequired: [],
        readOnlyIgnored: [],
      };
      let mapping: Array<ColumnDescriptor | undefined> = [];
      let headerSeen = false;

      const source = openCsvStream(request.filePath);
      const parser = source.pipe(
        parse({
          bom: true,
          delimiter,
          relax_column_count: true,
          skip_empty_lines: true,
          trim: false,
          columns: false,
        })
      );

      let batch: RowPlan[] = [];
      let aborted: ImportOutcome['aborted'];

      const flush = async () => {
        if (batch.length === 0) return;

        const pending = batch;
        batch = [];

        await commitBatch(pending);
      };

      const commitBatch = async (plans: RowPlan[]) => {
        const resolved = await resolveReferences(plans);
        applyReferences(plans, resolved);

        const identifierColumn = header.identifierColumn;
        const existing = identifierColumn
          ? await findExisting(request.uid, identifierColumn, plans)
          : new Map<string, string | number | 'ambiguous'>();

        const writes: Array<{ plan: RowPlan; action: RowAction; documentId?: string }> = [];

        for (const plan of plans) {
          counters.processedRows += 1;

          if (plan.errors.length > 0) {
            counters.failed += 1;
            plan.errors.forEach(recordError);
            continue;
          }

          const found =
            plan.identifierValue !== undefined
              ? (existing.get(plan.identifierValue) as string | 'ambiguous' | undefined)
              : undefined;

          const decision = decideAction(plan, found, request.mode);

          if (decision.error) {
            counters.failed += 1;
            recordError(decision.error);
            continue;
          }
          if (decision.action === 'skip') {
            counters.skipped += 1;
            continue;
          }
          if (request.dryRun) {
            if (decision.action === 'create') counters.created += 1;
            else counters.updated += 1;
            continue;
          }

          writes.push({ plan, action: decision.action, documentId: decision.documentId });
        }

        if (writes.length > 0) {
          await commitWrites(writes);
        }

        await request.onProgress?.({ ...counters });
      };

      const commitWrites = async (
        writes: Array<{ plan: RowPlan; action: RowAction; documentId?: string }>
      ) => {
        const applyAll = async () => {
          for (const write of writes) {
            await writeRow(
              request.uid,
              write.plan,
              write.action,
              write.documentId,
              supportsDraftPublish,
              localized
            );
          }
        };

        try {
          await strapi.db.transaction(applyAll);

          for (const write of writes) {
            if (write.action === 'create') counters.created += 1;
            else counters.updated += 1;
          }
          return;
        } catch (batchError) {
          strapi.log.debug(
            jobLogLine('import.batch-retry', {
              uid: request.uid,
              rows: writes.length,
              reason: batchError instanceof Error ? batchError.name : 'unknown',
            })
          );
        }

        // The batch failed as a unit, which on most databases poisons the whole transaction.
        // Retrying one row at a time isolates the offending rows so the rest still land.
        for (const write of writes) {
          try {
            await strapi.db.transaction(() =>
              writeRow(
                request.uid,
                write.plan,
                write.action,
                write.documentId,
                supportsDraftPublish,
                localized
              )
            );

            if (write.action === 'create') counters.created += 1;
            else counters.updated += 1;
          } catch (rowError) {
            counters.failed += 1;
            recordError({
              line: write.plan.line,
              code: 'write_failed',
              message: truncateForMessage(
                rowError instanceof Error ? rowError.message : 'The database rejected this row.'
              ),
            });
          }
        }
      };

      let line = 1;

      try {
        for await (const record of parser) {
          const cells = record as string[];

          if (!headerSeen) {
            headerSeen = true;

            if (cells.length > request.settings.maxColumns) {
              aborted = {
                code: 'too_many_columns',
                message: `The file has ${cells.length} columns; the limit is ${request.settings.maxColumns}.`,
              };
              break;
            }

            const validated = validateHeaders(
              cells,
              request.columns,
              request.collection,
              delimiter
            );
            header = validated.report;
            mapping = validated.mapping;

            if (header.recognised.length === 0) {
              aborted = {
                code: 'no_recognised_columns',
                message:
                  'None of the columns in this file match the collection. Download a fresh template and compare the header row.',
              };
              break;
            }
            // Duplicates are checked first: a repeated column is a more basic file defect, and a
            // required column that appears twice would otherwise be reported as missing.
            if (header.duplicateColumns.length > 0) {
              aborted = {
                code: 'duplicate_columns',
                message: `These columns appear more than once: ${header.duplicateColumns.join(', ')}.`,
              };
              break;
            }
            if (header.missingRequired.length > 0) {
              aborted = {
                code: 'missing_required_columns',
                message: `These required columns are missing: ${header.missingRequired.join(', ')}.`,
              };
              break;
            }

            continue;
          }

          line += 1;
          counters.totalRows += 1;

          if (counters.totalRows > request.settings.maxRows) {
            aborted = {
              code: 'too_many_rows',
              message: `The file has more than ${request.settings.maxRows} rows.`,
            };
            break;
          }

          batch.push(planRow(line, cells, mapping, request, header.identifierColumn));

          if (batch.length >= request.settings.batchSize) {
            await flush();
          }
        }
      } finally {
        // Every abort path leaves the loop with `break`, which ends the parser's iterator but
        // does not close the file the parser was piped from. Without this the descriptor stays
        // open until garbage collection, and on Windows the staged file cannot be deleted.
        parser.destroy();
        source.destroy();
      }

      if (!aborted) {
        await flush();
      }

      strapi.log.info(
        jobLogLine(request.dryRun ? 'import.dry-run.finished' : 'import.finished', {
          uid: request.uid,
          mode: request.mode,
          rows: counters.totalRows,
          created: counters.created,
          updated: counters.updated,
          skipped: counters.skipped,
          failed: counters.failed,
          aborted: aborted?.code,
        })
      );

      return { header, counters, errors, errorsTruncated, aborted };
    },
  };
};
