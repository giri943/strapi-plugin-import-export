import { PLUGIN_ID } from '../pluginId';

const KEY_PREFIX = `${PLUGIN_ID}:columns:`;

/**
 * Remembers a column selection per collection.
 *
 * Stored headers are only ever a hint: the server intersects them with the columns it generates,
 * and a saved selection whose headers have all disappeared from the schema falls back to the
 * full set rather than producing an empty file.
 */
export function loadColumnSelection(uid: string): string[] | undefined {
  try {
    const raw = window.localStorage.getItem(KEY_PREFIX + uid);
    if (!raw) return undefined;

    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return undefined;

    const headers = parsed.filter((header): header is string => typeof header === 'string');
    return headers.length > 0 ? headers : undefined;
  } catch {
    return undefined;
  }
}

export function saveColumnSelection(uid: string, headers: readonly string[]): void {
  try {
    window.localStorage.setItem(KEY_PREFIX + uid, JSON.stringify(headers));
  } catch {
    // A full or blocked storage quota must not stop an export.
  }
}

export function clearColumnSelection(uid: string): void {
  try {
    window.localStorage.removeItem(KEY_PREFIX + uid);
  } catch {
    // Nothing to recover from.
  }
}
