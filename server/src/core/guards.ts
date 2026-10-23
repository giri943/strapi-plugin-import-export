/**
 * Keys that must never be written onto an object built from user input. A CSV header of
 * `__proto__.polluted` would otherwise reach `Object.prototype` through the nested-path writer.
 */
const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

export function isUnsafeKey(key: string): boolean {
  return UNSAFE_KEYS.has(key);
}

export function emptyRecord<T = unknown>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

/**
 * Writes a value at a dotted/indexed path, creating intermediate objects and arrays as needed.
 * Refuses unsafe keys rather than sanitising them, so a malicious header fails the row instead of
 * silently importing a different shape than the file described.
 */
export function setAtPath(
  root: Record<string, unknown>,
  segments: Array<{ field: string; index?: number }>,
  value: unknown
): void {
  if (segments.length === 0) return;

  let cursor: Record<string, unknown> = root;

  for (let i = 0; i < segments.length; i += 1) {
    const { field, index } = segments[i];
    if (isUnsafeKey(field)) {
      throw new Error(`Unsafe field name in path: ${field}`);
    }

    const isLast = i === segments.length - 1;

    if (index === undefined) {
      if (isLast) {
        cursor[field] = value;
        return;
      }
      if (typeof cursor[field] !== 'object' || cursor[field] === null || Array.isArray(cursor[field])) {
        cursor[field] = emptyRecord();
      }
      cursor = cursor[field] as Record<string, unknown>;
      continue;
    }

    if (!Array.isArray(cursor[field])) {
      cursor[field] = [];
    }
    const list = cursor[field] as Array<Record<string, unknown>>;
    if (typeof list[index] !== 'object' || list[index] === null) {
      list[index] = emptyRecord();
    }

    if (isLast) {
      // A repeatable component segment is always addressed as `field[i].child`, so a path that
      // ends on the index itself is a malformed header rather than a value assignment.
      throw new Error(`Path ends on a repeatable index without a field: ${field}[${index}]`);
    }
    cursor = list[index];
  }
}

export function getAtPath(
  root: unknown,
  segments: Array<{ field: string; index?: number }>
): unknown {
  let cursor: unknown = root;

  for (const { field, index } of segments) {
    if (cursor === null || cursor === undefined) return undefined;
    if (typeof cursor !== 'object') return undefined;

    cursor = (cursor as Record<string, unknown>)[field];

    if (index !== undefined) {
      if (!Array.isArray(cursor)) return undefined;
      cursor = cursor[index];
    }
  }

  return cursor;
}

/**
 * Drops holes left by a sparse repeatable component (a template offers three slots, the user
 * fills slots 0 and 2) and removes entries whose every field came in empty.
 */
export function compactComponentArrays(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value
      .filter((entry) => entry !== undefined && entry !== null)
      .map((entry) => compactComponentArrays(entry))
      .filter((entry) => !isEmptyRecord(entry));
  }

  if (value !== null && typeof value === 'object') {
    const out = emptyRecord();
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      out[key] = compactComponentArrays(child);
    }
    return out;
  }

  return value;
}

function isEmptyRecord(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value !== 'object' || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) return true;
  return entries.every(([, child]) => child === undefined || child === null || child === '');
}
