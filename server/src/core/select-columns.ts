import { normaliseHeader } from './columns';
import type { ColumnDescriptor } from './types';

export interface ColumnSelection {
  columns: ColumnDescriptor[];
  /** Requested headers that match nothing in this collection. */
  unknown: string[];
  /** True when the caller asked for a subset rather than everything. */
  narrowed: boolean;
}

/**
 * Narrows the generated columns to the requested headers.
 *
 * Intersecting against the generated set is what makes this safe: a caller can only ever choose
 * from columns the plugin already decided to expose, so a private field or an invented header
 * cannot be smuggled in through the request. Order follows the generated columns, not the
 * request, so a file always reads in schema order.
 */
export function selectColumns(
  available: readonly ColumnDescriptor[],
  requested: readonly string[] | undefined
): ColumnSelection {
  if (!requested || requested.length === 0) {
    return { columns: [...available], unknown: [], narrowed: false };
  }

  const wanted = new Set(
    requested
      .filter((header): header is string => typeof header === 'string')
      .map((header) => normaliseHeader(header))
      .filter((header) => header.length > 0)
  );

  if (wanted.size === 0) {
    return { columns: [...available], unknown: [], narrowed: false };
  }

  const byHeader = new Set(available.map((column) => column.header));
  const unknown = [...wanted].filter((header) => !byHeader.has(header));
  const columns = available.filter((column) => wanted.has(column.header));

  // Every requested header was unrecognised, which almost always means a stale saved selection.
  // Falling back to the full set beats handing back a file with no columns at all.
  if (columns.length === 0) {
    return { columns: [...available], unknown, narrowed: false };
  }

  return { columns, unknown, narrowed: true };
}

/**
 * Parses the `columns` query parameter of the template route. Commas separate headers, and a
 * header can never contain one, so no escaping is needed.
 */
export function parseColumnsParam(raw: unknown): string[] | undefined {
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined;

  return raw
    .split(',')
    .map((header) => normaliseHeader(header))
    .filter((header) => header.length > 0);
}

export function asHeaderList(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;

  const headers = raw
    .filter((header): header is string => typeof header === 'string')
    .map((header) => normaliseHeader(header))
    .filter((header) => header.length > 0);

  return headers.length > 0 ? headers : undefined;
}
