import { describe, expect, it } from 'vitest';
import {
  UTF8_BOM,
  escapeFormula,
  firstLineOf,
  isSupportedDelimiter,
  sniffDelimiter,
  stripBom,
  unescapeFormula,
} from '../src/core/csv';

describe('escapeFormula', () => {
  it.each(['=1+1', '=cmd|\'/C calc\'!A0', '@SUM(A1)', '=HYPERLINK("http://evil")'])(
    'quotes the formula %j',
    (payload) => {
      expect(escapeFormula(payload)).toBe(`'${payload}`);
    }
  );

  it('quotes a payload that opens with a minus', () => {
    expect(escapeFormula('-2+3+cmd|\'/C calc\'!A0')).toBe("'-2+3+cmd|'/C calc'!A0");
  });

  it('quotes a leading tab or carriage return', () => {
    expect(escapeFormula('\t=1+1')).toBe("'\t=1+1");
    expect(escapeFormula('\r=1+1')).toBe("'\r=1+1");
  });

  it.each(['-5', '-5.25', '+3', '0', '1e10', '-1.5e-3', '.5', '-.5'])(
    'leaves the number %s untouched',
    (value) => {
      expect(escapeFormula(value)).toBe(value);
    }
  );

  it.each(['plain text', '', 'a=b', 'user@example.com', 'has - dash'])(
    'leaves %j untouched',
    (value) => {
      expect(escapeFormula(value)).toBe(value);
    }
  );

  it('round trips through unescapeFormula', () => {
    for (const value of ['=1+1', '@x', '-2+cmd', '\t=1']) {
      expect(unescapeFormula(escapeFormula(value))).toBe(value);
    }
  });

  it('does not strip an apostrophe that belongs to the data', () => {
    expect(unescapeFormula("'tis a quote")).toBe("'tis a quote");
    expect(unescapeFormula("O'Brien")).toBe("O'Brien");
  });
});

describe('sniffDelimiter', () => {
  it.each([
    ['a,b,c', ','],
    ['a;b;c', ';'],
    ['a\tb\tc', '\t'],
    ['a|b|c', '|'],
  ])('detects %j as %j', (line, expected) => {
    expect(sniffDelimiter(line)).toBe(expected);
  });

  it('picks the most frequent candidate', () => {
    expect(sniffDelimiter('a;b;c;d,e')).toBe(';');
  });

  it('ignores candidates inside a quoted header', () => {
    expect(sniffDelimiter('"last, first";age;city')).toBe(';');
  });

  it('handles a doubled quote inside a quoted header', () => {
    expect(sniffDelimiter('"say ""a,b,c,d""";x')).toBe(';');
  });

  it('falls back to a comma for a single column', () => {
    expect(sniffDelimiter('title')).toBe(',');
  });

  it('sees past a BOM', () => {
    expect(sniffDelimiter(`${UTF8_BOM}a;b`)).toBe(';');
  });
});

describe('stripBom and firstLineOf', () => {
  it('removes only a leading BOM', () => {
    expect(stripBom(`${UTF8_BOM}title`)).toBe('title');
    expect(stripBom(`title${UTF8_BOM}`)).toBe(`title${UTF8_BOM}`);
  });

  it.each([
    ['a,b\r\nrow', 'a,b'],
    ['a,b\nrow', 'a,b'],
    ['a,b\rrow', 'a,b'],
    ['a,b', 'a,b'],
  ])('reads the first line of %j', (chunk, expected) => {
    expect(firstLineOf(chunk)).toBe(expected);
  });
});

describe('isSupportedDelimiter', () => {
  it('accepts the four supported characters and nothing else', () => {
    expect([',', ';', '\t', '|'].every(isSupportedDelimiter)).toBe(true);
    expect(isSupportedDelimiter(':')).toBe(false);
    expect(isSupportedDelimiter('')).toBe(false);
  });
});
