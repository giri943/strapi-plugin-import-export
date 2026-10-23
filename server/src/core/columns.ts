import { isUnsafeKey } from './guards';
import type { ColumnSegment } from './types';

export const PATH_SEPARATOR = '.';
export const LOOKUP_SEPARATOR = ':';
export const MAX_HEADER_LENGTH = 200;
export const MAX_PATH_DEPTH = 5;
export const MAX_REPEATABLE_INDEX = 199;

const NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
const SEGMENT_PATTERN = /^([A-Za-z_][A-Za-z0-9_]*)(?:\[(\d{1,3})\])?$/;

export interface ParsedHeader {
  path: ColumnSegment[];
  lookupKey?: string;
}

export type ParseHeaderResult =
  | { ok: true; value: ParsedHeader }
  | { ok: false; code: string; message: string };

/** Strips the UTF-8 BOM and surrounding whitespace that spreadsheet software likes to add. */
export function normaliseHeader(raw: string): string {
  return raw.replace(/^\uFEFF/, '').trim();
}

export function parseHeader(raw: string): ParseHeaderResult {
  const header = normaliseHeader(raw);

  if (header.length === 0) {
    return { ok: false, code: 'empty_header', message: 'Column header is empty.' };
  }
  if (header.length > MAX_HEADER_LENGTH) {
    return {
      ok: false,
      code: 'header_too_long',
      message: `Column header exceeds ${MAX_HEADER_LENGTH} characters.`,
    };
  }

  const colonCount = header.split(LOOKUP_SEPARATOR).length - 1;
  if (colonCount > 1) {
    return {
      ok: false,
      code: 'multiple_lookup_separators',
      message: `Column header may contain at most one "${LOOKUP_SEPARATOR}".`,
    };
  }

  const [pathPart, lookupPart] = header.split(LOOKUP_SEPARATOR);

  if (pathPart.length === 0) {
    return {
      ok: false,
      code: 'missing_field_path',
      message: `Column header is missing a field name before "${LOOKUP_SEPARATOR}".`,
    };
  }

  const rawSegments = pathPart.split(PATH_SEPARATOR);
  if (rawSegments.length > MAX_PATH_DEPTH) {
    return {
      ok: false,
      code: 'path_too_deep',
      message: `Column header nests more than ${MAX_PATH_DEPTH} levels.`,
    };
  }

  const path: ColumnSegment[] = [];
  for (const rawSegment of rawSegments) {
    const match = SEGMENT_PATTERN.exec(rawSegment);
    if (!match) {
      return {
        ok: false,
        code: 'invalid_segment',
        message: `"${rawSegment}" is not a valid field name. Use letters, digits and underscores, optionally followed by [n].`,
      };
    }

    const [, field, indexText] = match;
    if (isUnsafeKey(field)) {
      return { ok: false, code: 'unsafe_field_name', message: `"${field}" is not allowed.` };
    }

    if (indexText === undefined) {
      path.push({ field });
      continue;
    }

    const index = Number(indexText);
    if (index > MAX_REPEATABLE_INDEX) {
      return {
        ok: false,
        code: 'index_out_of_range',
        message: `Repeatable index ${index} exceeds the maximum of ${MAX_REPEATABLE_INDEX}.`,
      };
    }
    path.push({ field, index });
  }

  if (lookupPart === undefined) {
    return { ok: true, value: { path } };
  }

  if (!NAME_PATTERN.test(lookupPart)) {
    return {
      ok: false,
      code: 'invalid_lookup_key',
      message: `"${lookupPart}" is not a valid lookup field name.`,
    };
  }
  if (isUnsafeKey(lookupPart)) {
    return { ok: false, code: 'unsafe_field_name', message: `"${lookupPart}" is not allowed.` };
  }

  return { ok: true, value: { path, lookupKey: lookupPart } };
}

export function formatHeader(parsed: ParsedHeader): string {
  const path = parsed.path
    .map(({ field, index }) => (index === undefined ? field : `${field}[${index}]`))
    .join(PATH_SEPARATOR);

  return parsed.lookupKey === undefined ? path : `${path}${LOOKUP_SEPARATOR}${parsed.lookupKey}`;
}

/**
 * Builds the header for one entry of a repeatable component by stamping an index onto the
 * segment at `depth`, so the same descriptor tree can emit `faq[0].question`, `faq[1].question`
 * and so on without being rebuilt.
 */
export function withIndex(path: ColumnSegment[], depth: number, index: number): ColumnSegment[] {
  return path.map((segment, i) => (i === depth ? { ...segment, index } : { ...segment }));
}

/**
 * Escapes a single value so it survives being joined into a delimited cell. Backslash is escaped
 * first; reversing the order would double-escape the delimiter markers written in this same pass.
 */
export function escapeMultiValue(value: string, delimiter: string): string {
  return value.split('\\').join('\\\\').split(delimiter).join(`\\${delimiter}`);
}

export function joinMultiValue(values: readonly string[], delimiter: string): string {
  return values.map((value) => escapeMultiValue(value, delimiter)).join(delimiter);
}

export function splitMultiValue(cell: string, delimiter: string): string[] {
  if (cell.trim().length === 0) return [];

  const out: string[] = [];
  let current = '';

  for (let i = 0; i < cell.length; i += 1) {
    const char = cell[i];

    if (char === '\\' && i + 1 < cell.length) {
      current += cell[i + 1];
      i += 1;
      continue;
    }
    if (char === delimiter) {
      out.push(current);
      current = '';
      continue;
    }
    current += char;
  }
  out.push(current);

  return out.map((value) => value.trim()).filter((value) => value.length > 0);
}

/**
 * Suggests the intended column for a header that did not match the schema. Catches the common
 * cases of a changed case or a stray space without silently accepting either.
 */
export function suggestColumn(unknownHeader: string, knownHeaders: readonly string[]): string | undefined {
  const needle = unknownHeader.toLowerCase().replace(/[\s_-]/g, '');

  for (const candidate of knownHeaders) {
    if (candidate.toLowerCase().replace(/[\s_-]/g, '') === needle) {
      return candidate;
    }
  }

  return undefined;
}
