import { formatScalar } from './coerce';
import { joinMultiValue } from './columns';
import { escapeFormula } from './csv';
import { getAtPath } from './guards';
import { DEFAULT_RELATION_LOOKUP_KEY } from './schema';
import type { ColumnDescriptor } from './types';

export interface RenderOptions {
  multiValueDelimiter: string;
  escapeFormulas: boolean;
}

/** Turns one document into the cells of one CSV row, in column order. */
export function renderRow(
  document: Record<string, unknown>,
  columns: readonly ColumnDescriptor[],
  options: RenderOptions
): string[] {
  return columns.map((column) => {
    const cell = renderCell(document, column, options);
    return options.escapeFormulas ? escapeFormula(cell) : cell;
  });
}

function renderCell(
  document: Record<string, unknown>,
  column: ColumnDescriptor,
  options: RenderOptions
): string {
  const raw = getAtPath(document, column.path);

  switch (column.kind) {
    case 'meta':
    case 'scalar':
      return formatScalar(raw);

    case 'json':
      return raw === null || raw === undefined ? '' : JSON.stringify(raw);

    case 'dynamiczone':
      return Array.isArray(raw) && raw.length > 0 ? JSON.stringify(raw) : '';

    case 'relation':
    case 'media':
      return renderReference(raw, column, options);

    default:
      return formatScalar(raw);
  }
}

function renderReference(
  raw: unknown,
  column: ColumnDescriptor,
  options: RenderOptions
): string {
  const key = column.lookupKey ?? DEFAULT_RELATION_LOOKUP_KEY;

  const valueOf = (entry: unknown): string | undefined => {
    if (entry === null || entry === undefined) return undefined;
    if (typeof entry !== 'object') return formatScalar(entry);

    const record = entry as Record<string, unknown>;
    const direct = record[key];
    if (direct !== null && direct !== undefined) return formatScalar(direct);

    // An export must never emit a blank cell for a relation that exists; falling back to the
    // document id keeps the row re-importable even when the configured key is empty.
    const fallback = record[DEFAULT_RELATION_LOOKUP_KEY] ?? record.id;
    return fallback === null || fallback === undefined ? undefined : formatScalar(fallback);
  };

  if (Array.isArray(raw)) {
    const values = raw
      .map(valueOf)
      .filter((value): value is string => value !== undefined && value.length > 0);

    return joinMultiValue(values, options.multiValueDelimiter);
  }

  const single = valueOf(raw);
  if (single === undefined) return '';

  // A single-valued column still escapes the list delimiter, so a slug containing `;` survives
  // the round trip instead of splitting into two references on the way back in.
  return column.multiple ? joinMultiValue([single], options.multiValueDelimiter) : single;
}
