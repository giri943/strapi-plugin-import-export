import { describe, expect, it } from 'vitest';
import { coerceScalar, formatScalar, safeJsonParse } from '../src/core/coerce';
import type { ScalarAttribute } from '../src/core/types';

const attr = (overrides: Partial<ScalarAttribute> & { type: ScalarAttribute['type'] }) =>
  overrides as ScalarAttribute;

const value = (raw: string, attribute: ScalarAttribute) => {
  const result = coerceScalar(raw, attribute);
  if (!result.ok) throw new Error(`expected ${raw} to coerce, got ${result.code}: ${result.message}`);
  return result.value;
};

const error = (raw: string, attribute: ScalarAttribute) => {
  const result = coerceScalar(raw, attribute);
  if (result.ok) throw new Error(`expected ${raw} to be rejected`);
  return result;
};

describe('empty cells', () => {
  it('clears an optional field', () => {
    expect(value('', attr({ type: 'string' }))).toBeNull();
    expect(value('   ', attr({ type: 'integer' }))).toBeNull();
  });

  it('fails a required field', () => {
    expect(error('', attr({ type: 'string', required: true })).code).toBe('required');
  });
});

describe('strings', () => {
  it('trims surrounding whitespace', () => {
    expect(value('  hello  ', attr({ type: 'string' }))).toBe('hello');
  });

  it('enforces maxLength', () => {
    expect(error('abcd', attr({ type: 'string', maxLength: 3 })).code).toBe('too_long');
  });

  it('enforces minLength', () => {
    expect(error('ab', attr({ type: 'string', minLength: 3 })).code).toBe('too_short');
  });
});

describe('email', () => {
  it.each(['a@b.co', 'first.last+tag@sub.example.org'])('accepts %s', (input) => {
    expect(value(input, attr({ type: 'email' }))).toBe(input);
  });

  it.each(['plain', 'a@b', 'a b@c.com', 'a@b.c', 'a,b@c.com'])('rejects %j', (input) => {
    expect(error(input, attr({ type: 'email' })).code).toBe('invalid_email');
  });
});

describe('uid', () => {
  it('accepts a slug', () => {
    expect(value('my-post_2~x', attr({ type: 'uid' }))).toBe('my-post_2~x');
  });

  it('rejects spaces and slashes', () => {
    expect(error('my post', attr({ type: 'uid' })).code).toBe('invalid_uid');
    expect(error('a/b', attr({ type: 'uid' })).code).toBe('invalid_uid');
  });
});

describe('enumeration', () => {
  const enumAttr = attr({ type: 'enumeration', enum: ['draft', 'review', 'live'] });

  it('accepts an exact option', () => {
    expect(value('review', enumAttr)).toBe('review');
  });

  it('rejects a wrong case but names the intended option', () => {
    const result = error('Review', enumAttr);
    expect(result.code).toBe('invalid_enum');
    expect(result.message).toContain('Did you mean "review"?');
  });

  it('rejects an unknown option and lists the allowed ones', () => {
    expect(error('nope', enumAttr).message).toContain('draft, review, live');
  });
});

describe('boolean', () => {
  it.each(['true', 'TRUE', '1', 'yes', 'Y', 'on'])('reads %s as true', (input) => {
    expect(value(input, attr({ type: 'boolean' }))).toBe(true);
  });

  it.each(['false', 'FALSE', '0', 'no', 'N', 'off'])('reads %s as false', (input) => {
    expect(value(input, attr({ type: 'boolean' }))).toBe(false);
  });

  it('rejects anything else', () => {
    expect(error('maybe', attr({ type: 'boolean' })).code).toBe('invalid_boolean');
  });
});

describe('numbers', () => {
  it('reads an integer', () => {
    expect(value('42', attr({ type: 'integer' }))).toBe(42);
    expect(value('-42', attr({ type: 'integer' }))).toBe(-42);
  });

  it('rejects a decimal in an integer field', () => {
    expect(error('4.2', attr({ type: 'integer' })).code).toBe('invalid_integer');
  });

  it('rejects an integer beyond safe precision', () => {
    expect(error('9007199254740993', attr({ type: 'integer' })).code).toBe('integer_out_of_range');
  });

  it('keeps a biginteger as a string to preserve precision', () => {
    expect(value('9007199254740993', attr({ type: 'biginteger' }))).toBe('9007199254740993');
  });

  it('reads decimals and floats', () => {
    expect(value('4.25', attr({ type: 'decimal' }))).toBe(4.25);
    expect(value('-1.5e3', attr({ type: 'float' }))).toBe(-1500);
  });

  it('enforces min and max', () => {
    expect(error('1', attr({ type: 'integer', min: 5 })).code).toBe('below_min');
    expect(error('9', attr({ type: 'integer', max: 5 })).code).toBe('above_max');
  });

  it('rejects text that is not a number', () => {
    expect(error('12abc', attr({ type: 'decimal' })).code).toBe('invalid_number');
    expect(error('NaN', attr({ type: 'float' })).code).toBe('invalid_number');
    expect(error('Infinity', attr({ type: 'float' })).code).toBe('invalid_number');
  });
});

describe('dates', () => {
  it('reads an ISO date', () => {
    expect(value('2026-01-31', attr({ type: 'date' }))).toBe('2026-01-31');
  });

  it('accepts slashes in a date', () => {
    expect(value('2026/01/31', attr({ type: 'date' }))).toBe('2026-01-31');
  });

  it('rejects a date that does not exist', () => {
    expect(error('2026-02-30', attr({ type: 'date' })).code).toBe('invalid_date');
  });

  it('rejects an ambiguous regional format', () => {
    expect(error('31/01/2026', attr({ type: 'date' })).code).toBe('invalid_date');
    expect(error('01/31/2026', attr({ type: 'date' })).code).toBe('invalid_date');
  });

  it('normalises a datetime to ISO with a zone', () => {
    expect(value('2026-01-31T09:00:00Z', attr({ type: 'datetime' }))).toBe(
      '2026-01-31T09:00:00.000Z'
    );
  });

  it('widens a bare date in a datetime field to midnight UTC', () => {
    expect(value('2026-01-31', attr({ type: 'datetime' }))).toBe('2026-01-31T00:00:00.000Z');
  });

  it('rejects unparseable datetimes', () => {
    expect(error('not a date', attr({ type: 'datetime' })).code).toBe('invalid_datetime');
  });
});

describe('time', () => {
  it.each([
    ['09:30', '09:30:00.000'],
    ['9:30', '09:30:00.000'],
    ['09:30:15', '09:30:15.000'],
    ['09:30:15.5', '09:30:15.500'],
  ])('reads %s as %s', (input, expected) => {
    expect(value(input, attr({ type: 'time' }))).toBe(expected);
  });

  it('rejects an impossible clock time', () => {
    expect(error('25:00', attr({ type: 'time' })).code).toBe('invalid_time');
    expect(error('09:75', attr({ type: 'time' })).code).toBe('invalid_time');
  });
});

describe('json', () => {
  it('parses an object', () => {
    expect(value('{"a":1}', attr({ type: 'json' }))).toEqual({ a: 1 });
  });

  it('parses a blocks array', () => {
    expect(value('[{"type":"paragraph"}]', attr({ type: 'blocks' }))).toEqual([
      { type: 'paragraph' },
    ]);
  });

  it('rejects malformed JSON', () => {
    expect(error('{nope}', attr({ type: 'json' })).code).toBe('invalid_json');
  });

  it('refuses a prototype pollution payload', () => {
    const result = safeJsonParse('{"__proto__":{"polluted":true}}');
    expect(result.ok).toBe(false);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
  });

  it('refuses a nested prototype pollution payload', () => {
    expect(safeJsonParse('{"a":{"constructor":{"x":1}}}').ok).toBe(false);
  });
});

describe('password', () => {
  it('is never importable', () => {
    expect(error('hunter2', attr({ type: 'password' })).code).toBe('password_not_importable');
  });
});

describe('formatScalar', () => {
  it.each([
    [null, ''],
    [undefined, ''],
    ['text', 'text'],
    [42, '42'],
    [4.25, '4.25'],
    [true, 'true'],
    [false, 'false'],
  ])('renders %j as %j', (input, expected) => {
    expect(formatScalar(input)).toBe(expected);
  });

  it('renders a date as ISO', () => {
    expect(formatScalar(new Date('2026-01-31T09:00:00Z'))).toBe('2026-01-31T09:00:00.000Z');
  });

  it('renders an object as JSON', () => {
    expect(formatScalar({ a: 1 })).toBe('{"a":1}');
  });
});
