import { describe, expect, it } from 'vitest';
import { parse } from 'csv-parse/sync';
import { stringify } from 'csv-stringify/sync';
import {
  AMBIGUOUS_FIELD_CHARS,
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

describe('AMBIGUOUS_FIELD_CHARS', () => {
  const matches = (value: string) => AMBIGUOUS_FIELD_CHARS.test(value);

  it.each(['Girish Soman', 'category:name', 'a;b', 'a|b', 'a\tb', '2026-10-23T12:00:00.000Z'])(
    'flags %j for quoting',
    (value) => {
      expect(matches(value)).toBe(true);
    }
  );

  it.each(['documentId', 'news', '12', '4.5', '-5', '', 'ada@example.com', '2026-10-23'])(
    'leaves %j unquoted',
    (value) => {
      expect(matches(value)).toBe(false);
    }
  );
});

describe('writing a file a spreadsheet cannot mis-split', () => {
  const write = (rows: string[][]) =>
    stringify(rows, {
      delimiter: ',',
      record_delimiter: 'windows',
      quoted_match: AMBIGUOUS_FIELD_CHARS,
    });

  it('quotes a one-column value holding a space', () => {
    expect(write([['full_name'], ['Girish Soman']])).toBe(
      'full_name\r\n"Girish Soman"\r\n'
    );
  });

  it('quotes a relation label header so a colon cannot split it', () => {
    expect(write([['enquiry_type:title'], ['Contract Manufacturing']])).toBe(
      '"enquiry_type:title"\r\n"Contract Manufacturing"\r\n'
    );
  });

  it('leaves numbers bare so a spreadsheet still reads them as numbers', () => {
    expect(write([['views', 'rating'], ['12', '4.5']])).toBe('views,rating\r\n12,4.5\r\n');
  });

  it('survives a reader that guesses space as the separator', () => {
    const file = write([['full_name'], ['Girish Soman']]);

    expect(parse(file, { delimiter: ' ', quote: '"' })).toEqual([
      ['full_name'],
      ['Girish Soman'],
    ]);
  });

  it('splits on a space guess without the quoting, which is the bug it fixes', () => {
    const file = stringify([['full_name'], ['Girish Soman']], {
      delimiter: ',',
      record_delimiter: 'windows',
    });

    expect(parse(file, { delimiter: ' ', quote: '"', relax_column_count: true })).toEqual([
      ['full_name'],
      ['Girish', 'Soman'],
    ]);
  });

  it('still round trips through the plugin parser', () => {
    const rows = [
      ['documentId', 'title', 'views', 'category:name'],
      ['abc', 'News one', '12', 'News'],
      ['def', '', '0', ''],
    ];

    expect(parse(write(rows), { bom: true })).toEqual(rows);
  });
});
