import { DEFAULT_RELATION_LOOKUP_KEY } from './schema';
import type { ColumnDescriptor } from './types';

export const FILTERABLE_DATE_FIELDS = ['createdAt', 'updatedAt', 'publishedAt'] as const;
export type FilterableDateField = (typeof FILTERABLE_DATE_FIELDS)[number];

export const MAX_RELATION_FILTERS = 10;
export const MAX_FILTER_VALUES = 200;

export interface RelationFilterInput {
  field?: unknown;
  documentIds?: unknown;
}

export interface DateFilterInput {
  field?: unknown;
  from?: unknown;
  to?: unknown;
}

export interface RelationFilter {
  field: string;
  documentIds: string[];
}

export interface DateFilter {
  field: FilterableDateField;
  from?: string;
  to?: string;
}

export type FilterParseResult =
  | { ok: true; relations: RelationFilter[]; dates: DateFilter[] }
  | { ok: false; code: string; message: string };

/**
 * Turns a request payload into filters.
 *
 * The payload is deliberately narrow — a field name and a list of documentIds — rather than a
 * Strapi filter object. Accepting raw filters from the admin panel would let a caller query any
 * column of any joined table, including ones the plugin takes care never to expose.
 */
export function parseExportFilters(
  columns: readonly ColumnDescriptor[],
  input: { relationFilters?: unknown; dateFilters?: unknown },
  options: { hasDraftAndPublish: boolean }
): FilterParseResult {
  const relations = parseRelationFilters(columns, input.relationFilters);
  if (!relations.ok) return relations;

  const dates = parseDateFilters(input.dateFilters, options.hasDraftAndPublish);
  if (!dates.ok) return dates;

  return { ok: true, relations: relations.value, dates: dates.value };
}

type Parsed<T> = { ok: true; value: T } | { ok: false; code: string; message: string };

function parseRelationFilters(
  columns: readonly ColumnDescriptor[],
  raw: unknown
): Parsed<RelationFilter[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };

  if (!Array.isArray(raw)) {
    return { ok: false, code: 'invalid_relation_filters', message: 'relationFilters must be an array.' };
  }
  if (raw.length > MAX_RELATION_FILTERS) {
    return {
      ok: false,
      code: 'too_many_relation_filters',
      message: `At most ${MAX_RELATION_FILTERS} relation filters are allowed.`,
    };
  }

  const filterable = relationFilterFields(columns);
  const out: RelationFilter[] = [];
  const seen = new Set<string>();

  for (const entry of raw as RelationFilterInput[]) {
    const field = typeof entry?.field === 'string' ? entry.field.trim() : '';
    if (field.length === 0) {
      return { ok: false, code: 'missing_filter_field', message: 'Every relation filter needs a field.' };
    }
    if (!filterable.has(field)) {
      return {
        ok: false,
        code: 'field_not_filterable',
        message: `"${field}" is not a relation on this collection that can be filtered.`,
      };
    }
    if (seen.has(field)) {
      return {
        ok: false,
        code: 'duplicate_filter_field',
        message: `"${field}" appears in more than one filter. Put all its values in one.`,
      };
    }
    seen.add(field);

    if (!Array.isArray(entry.documentIds)) {
      return {
        ok: false,
        code: 'missing_filter_values',
        message: `The filter on "${field}" needs a documentIds array.`,
      };
    }

    const documentIds = Array.from(
      new Set(
        entry.documentIds
          .filter((value): value is string => typeof value === 'string')
          .map((value) => value.trim())
          .filter((value) => value.length > 0)
      )
    );

    if (documentIds.length === 0) {
      // An empty list means "no constraint" rather than "match nothing", which is what a UI
      // sends while the user is still choosing.
      continue;
    }
    if (documentIds.length > MAX_FILTER_VALUES) {
      return {
        ok: false,
        code: 'too_many_filter_values',
        message: `The filter on "${field}" has ${documentIds.length} values; the limit is ${MAX_FILTER_VALUES}.`,
      };
    }

    out.push({ field, documentIds });
  }

  return { ok: true, value: out };
}

function parseDateFilters(raw: unknown, hasDraftAndPublish: boolean): Parsed<DateFilter[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };

  if (!Array.isArray(raw)) {
    return { ok: false, code: 'invalid_date_filters', message: 'dateFilters must be an array.' };
  }

  const allowed = new Set<string>(
    hasDraftAndPublish ? FILTERABLE_DATE_FIELDS : ['createdAt', 'updatedAt']
  );
  const out: DateFilter[] = [];

  for (const entry of raw as DateFilterInput[]) {
    const field = typeof entry?.field === 'string' ? entry.field.trim() : '';
    if (!allowed.has(field)) {
      return {
        ok: false,
        code: 'field_not_filterable',
        message: `"${field}" cannot be used as a date filter. Allowed: ${[...allowed].join(', ')}.`,
      };
    }

    const from = normaliseBoundary(entry.from, 'start');
    if (from === 'invalid') {
      return { ok: false, code: 'invalid_date', message: `The "from" date for ${field} is not a date.` };
    }
    const to = normaliseBoundary(entry.to, 'end');
    if (to === 'invalid') {
      return { ok: false, code: 'invalid_date', message: `The "to" date for ${field} is not a date.` };
    }

    if (from === undefined && to === undefined) continue;

    if (from && to && from > to) {
      return {
        ok: false,
        code: 'date_range_reversed',
        message: `The ${field} range starts after it ends.`,
      };
    }

    out.push({ field: field as FilterableDateField, from, to });
  }

  return { ok: true, value: out };
}

/**
 * Widens a bare `YYYY-MM-DD` to cover the whole day. A user who filters "to 31 January" means
 * the end of the 31st, not midnight at its start.
 */
function normaliseBoundary(
  raw: unknown,
  edge: 'start' | 'end'
): string | undefined | 'invalid' {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (typeof raw !== 'string') return 'invalid';

  const value = raw.trim();
  if (value.length === 0) return undefined;

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const widened = edge === 'start' ? `${value}T00:00:00.000Z` : `${value}T23:59:59.999Z`;
    return Number.isNaN(new Date(widened).getTime()) ? 'invalid' : widened;
  }

  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? 'invalid' : parsed.toISOString();
}

/** Top-level relation columns that can be filtered on, excluding the read-only label copies. */
export function relationFilterFields(columns: readonly ColumnDescriptor[]): Set<string> {
  const fields = new Set<string>();

  for (const column of columns) {
    if (column.kind !== 'relation') continue;
    if (column.isLabel) continue;
    if (column.path.length !== 1) continue;

    const segment = column.path[0];
    if (!segment || segment.index !== undefined) continue;

    fields.add(segment.field);
  }

  return fields;
}

/** Builds the Strapi filter object. Values within a field are OR; fields are AND. */
export function buildFilters(input: {
  relations: readonly RelationFilter[];
  dates: readonly DateFilter[];
  documentIds?: readonly string[];
}): Record<string, unknown> | undefined {
  const filters: Record<string, unknown> = {};

  if (input.documentIds && input.documentIds.length > 0) {
    filters.documentId = { $in: [...input.documentIds] };
  }

  for (const relation of input.relations) {
    filters[relation.field] = {
      [DEFAULT_RELATION_LOOKUP_KEY]: { $in: relation.documentIds },
    };
  }

  for (const date of input.dates) {
    const bounds: Record<string, string> = {};
    if (date.from) bounds.$gte = date.from;
    if (date.to) bounds.$lte = date.to;

    filters[date.field] = bounds;
  }

  return Object.keys(filters).length > 0 ? filters : undefined;
}
