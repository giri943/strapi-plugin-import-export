import { isUnsafeKey } from './guards';
import type { ScalarAttribute } from './types';

export type CoerceResult =
  | { ok: true; value: unknown }
  | { ok: false; code: string; message: string };

const TRUE_TOKENS = new Set(['true', '1', 'yes', 'y', 'on']);
const FALSE_TOKENS = new Set(['false', '0', 'no', 'n', 'off']);

const INTEGER_PATTERN = /^[+-]?\d+$/;
const DECIMAL_PATTERN = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;
const DATE_PATTERN = /^(\d{4})[-/](\d{2})[-/](\d{2})$/;
const TIME_PATTERN = /^(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\.(\d{1,3}))?$/;
const UID_PATTERN = /^[A-Za-z0-9_~-]+$/;
const EMAIL_PATTERN = /^[^\s@,;]+@[^\s@,;]+\.[^\s@,;]{2,}$/;

/**
 * Converts one CSV cell into a value for the given attribute.
 *
 * An empty cell resolves to `null`, which clears the field. The file declares intent by including
 * the column at all, so a column that is present and blank is read as "make this empty" rather
 * than "leave as is". Columns absent from the file are never touched.
 */
export function coerceScalar(raw: string, attribute: ScalarAttribute): CoerceResult {
  const value = raw.trim();

  if (value.length === 0) {
    if (attribute.required === true) {
      return { ok: false, code: 'required', message: 'A value is required.' };
    }
    return { ok: true, value: null };
  }

  switch (attribute.type) {
    case 'string':
    case 'text':
    case 'richtext':
      return withLengthBounds(value, attribute);

    case 'email': {
      if (!EMAIL_PATTERN.test(value)) {
        return { ok: false, code: 'invalid_email', message: `"${value}" is not a valid email.` };
      }
      return withLengthBounds(value, attribute);
    }

    case 'uid': {
      if (!UID_PATTERN.test(value)) {
        return {
          ok: false,
          code: 'invalid_uid',
          message: `"${value}" is not a valid slug. Use letters, digits, hyphens, underscores and tildes.`,
        };
      }
      return withLengthBounds(value, attribute);
    }

    case 'enumeration': {
      const allowed = attribute.enum ?? [];
      if (allowed.includes(value)) return { ok: true, value };

      const caseMatch = allowed.find((option) => option.toLowerCase() === value.toLowerCase());
      const suffix = caseMatch ? ` Did you mean "${caseMatch}"?` : '';

      return {
        ok: false,
        code: 'invalid_enum',
        message: `"${value}" is not one of: ${allowed.join(', ')}.${suffix}`,
      };
    }

    case 'boolean': {
      const token = value.toLowerCase();
      if (TRUE_TOKENS.has(token)) return { ok: true, value: true };
      if (FALSE_TOKENS.has(token)) return { ok: true, value: false };

      return {
        ok: false,
        code: 'invalid_boolean',
        message: `"${value}" is not a boolean. Use true or false.`,
      };
    }

    case 'integer': {
      if (!INTEGER_PATTERN.test(value)) {
        return { ok: false, code: 'invalid_integer', message: `"${value}" is not a whole number.` };
      }
      const parsed = Number(value);
      if (!Number.isSafeInteger(parsed)) {
        return {
          ok: false,
          code: 'integer_out_of_range',
          message: `"${value}" is too large for an integer field. Use a Big integer field instead.`,
        };
      }
      return withNumericBounds(parsed, attribute);
    }

    case 'biginteger': {
      if (!INTEGER_PATTERN.test(value)) {
        return { ok: false, code: 'invalid_integer', message: `"${value}" is not a whole number.` };
      }
      // Strapi stores biginteger as a string to survive values beyond IEEE-754 precision.
      return { ok: true, value };
    }

    case 'decimal':
    case 'float': {
      if (!DECIMAL_PATTERN.test(value)) {
        return { ok: false, code: 'invalid_number', message: `"${value}" is not a number.` };
      }
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) {
        return { ok: false, code: 'invalid_number', message: `"${value}" is not a finite number.` };
      }
      return withNumericBounds(parsed, attribute);
    }

    case 'date':
      return coerceDate(value);

    case 'datetime':
      return coerceDateTime(value);

    case 'time':
      return coerceTime(value);

    case 'timestamp': {
      if (!INTEGER_PATTERN.test(value)) {
        return {
          ok: false,
          code: 'invalid_timestamp',
          message: `"${value}" is not a Unix timestamp.`,
        };
      }
      return { ok: true, value: Number(value) };
    }

    case 'json':
    case 'blocks':
      return safeJsonParse(value);

    case 'password':
      return {
        ok: false,
        code: 'password_not_importable',
        message: 'Password fields cannot be imported.',
      };

    default:
      return withLengthBounds(value, attribute);
  }
}

function withLengthBounds(value: string, attribute: ScalarAttribute): CoerceResult {
  if (attribute.minLength !== undefined && value.length < attribute.minLength) {
    return {
      ok: false,
      code: 'too_short',
      message: `Needs at least ${attribute.minLength} characters, got ${value.length}.`,
    };
  }
  if (attribute.maxLength !== undefined && value.length > attribute.maxLength) {
    return {
      ok: false,
      code: 'too_long',
      message: `Allows at most ${attribute.maxLength} characters, got ${value.length}.`,
    };
  }
  return { ok: true, value };
}

function withNumericBounds(value: number, attribute: ScalarAttribute): CoerceResult {
  if (attribute.min !== undefined && value < attribute.min) {
    return { ok: false, code: 'below_min', message: `Must be ${attribute.min} or more.` };
  }
  if (attribute.max !== undefined && value > attribute.max) {
    return { ok: false, code: 'above_max', message: `Must be ${attribute.max} or less.` };
  }
  return { ok: true, value };
}

function coerceDate(value: string): CoerceResult {
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    return {
      ok: false,
      code: 'invalid_date',
      message: `"${value}" is not a date. Use YYYY-MM-DD.`,
    };
  }

  const [, year, month, day] = match;
  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00Z`);

  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== iso) {
    return { ok: false, code: 'invalid_date', message: `"${value}" is not a real calendar date.` };
  }

  return { ok: true, value: iso };
}

function coerceDateTime(value: string): CoerceResult {
  const dateOnly = DATE_PATTERN.exec(value);
  if (dateOnly) {
    const asDate = coerceDate(value);
    if (!asDate.ok) return asDate;
    return { ok: true, value: `${asDate.value as string}T00:00:00.000Z` };
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return {
      ok: false,
      code: 'invalid_datetime',
      message: `"${value}" is not a date and time. Use ISO 8601, for example 2026-01-31T09:00:00Z.`,
    };
  }

  return { ok: true, value: parsed.toISOString() };
}

function coerceTime(value: string): CoerceResult {
  const match = TIME_PATTERN.exec(value);
  if (!match) {
    return {
      ok: false,
      code: 'invalid_time',
      message: `"${value}" is not a time. Use HH:mm or HH:mm:ss.`,
    };
  }

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = Number(match[3] ?? '0');

  if (hours > 23 || minutes > 59 || seconds > 59) {
    return { ok: false, code: 'invalid_time', message: `"${value}" is not a valid clock time.` };
  }

  const pad = (part: number) => String(part).padStart(2, '0');
  const base = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;

  return { ok: true, value: match[4] ? `${base}.${match[4].padEnd(3, '0')}` : `${base}.000` };
}

export function safeJsonParse(raw: string): CoerceResult {
  try {
    const parsed = JSON.parse(raw, (key, value) => {
      if (isUnsafeKey(key)) {
        throw new SyntaxError(`the key "${key}" is not allowed`);
      }
      return value;
    });
    return { ok: true, value: parsed };
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'unparseable';
    return { ok: false, code: 'invalid_json', message: `Not valid JSON: ${reason}.` };
  }
}

/** Renders a stored value back into a CSV cell. Formula escaping happens in the writer. */
export function formatScalar(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (value instanceof Date) return value.toISOString();

  return JSON.stringify(value);
}
