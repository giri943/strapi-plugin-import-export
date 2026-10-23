export const UTF8_BOM = '\uFEFF';
export const SUPPORTED_DELIMITERS = [',', ';', '\t', '|'] as const;
export type CsvDelimiter = (typeof SUPPORTED_DELIMITERS)[number];

/**
 * Leading characters that make Excel, LibreOffice and Google Sheets treat a cell as a formula
 * rather than text.
 */
const FORMULA_PREFIXES = new Set(['=', '+', '-', '@', '\t', '\r']);

const NUMERIC_LITERAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

export function stripBom(text: string): string {
  return text.startsWith(UTF8_BOM) ? text.slice(UTF8_BOM.length) : text;
}

/**
 * Neutralises spreadsheet formula injection by prefixing the cell with an apostrophe.
 *
 * Plain negative and signed numbers are left alone. They start with a character on the dangerous
 * list but cannot carry a payload, and quoting them would turn every `-5` in an export into the
 * text `'-5`, which then fails to re-import as a number.
 */
export function escapeFormula(value: string): string {
  if (value.length === 0) return value;
  if (!FORMULA_PREFIXES.has(value[0])) return value;
  if (NUMERIC_LITERAL.test(value)) return value;

  return `'${value}`;
}

/** Reverses `escapeFormula` so an exported file re-imports to the value it started as. */
export function unescapeFormula(value: string): string {
  if (value.length < 2 || value[0] !== "'") return value;
  if (!FORMULA_PREFIXES.has(value[1])) return value;

  return value.slice(1);
}

/**
 * Picks the delimiter from a header line by counting candidates outside quoted sections, so a
 * file saved by Excel in a locale that uses `;` imports without the operator changing anything.
 */
export function sniffDelimiter(headerLine: string, fallback: CsvDelimiter = ','): CsvDelimiter {
  const line = stripBom(headerLine);
  const counts = new Map<string, number>();
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        i += 1;
        continue;
      }
      inQuotes = !inQuotes;
      continue;
    }
    if (inQuotes) continue;

    if ((SUPPORTED_DELIMITERS as readonly string[]).includes(char)) {
      counts.set(char, (counts.get(char) ?? 0) + 1);
    }
  }

  let best: CsvDelimiter = fallback;
  let bestCount = 0;

  for (const candidate of SUPPORTED_DELIMITERS) {
    const count = counts.get(candidate) ?? 0;
    if (count > bestCount) {
      best = candidate;
      bestCount = count;
    }
  }

  return bestCount > 0 ? best : fallback;
}

export function isSupportedDelimiter(value: string): value is CsvDelimiter {
  return (SUPPORTED_DELIMITERS as readonly string[]).includes(value);
}

/** Reads the first line out of a leading chunk of a file, for delimiter sniffing. */
export function firstLineOf(chunk: string): string {
  const stripped = stripBom(chunk);
  const breakIndex = stripped.search(/\r\n|\n|\r/);

  return breakIndex === -1 ? stripped : stripped.slice(0, breakIndex);
}

export function describeDelimiter(delimiter: string): string {
  switch (delimiter) {
    case ',':
      return 'comma';
    case ';':
      return 'semicolon';
    case '\t':
      return 'tab';
    case '|':
      return 'pipe';
    default:
      return `"${delimiter}"`;
  }
}
