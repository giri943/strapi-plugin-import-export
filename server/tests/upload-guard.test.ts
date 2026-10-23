import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { inspectUpload } from '../src/utils/upload-guard';

let directory: string;

const writeFile = async (name: string, contents: Buffer | string): Promise<string> => {
  const target = path.join(directory, name);
  await fs.writeFile(target, contents);
  return target;
};

const inspect = (filePath: string, fileName: string, maxFileSizeMb = 50) =>
  inspectUpload(
    { filepath: filePath, originalFilename: fileName, mimetype: 'text/csv' },
    { maxFileSizeMb }
  );

beforeAll(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'import-export-guard-test-'));
});

afterAll(async () => {
  await fs.rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

describe('inspectUpload', () => {
  it('accepts a plain CSV', async () => {
    const file = await writeFile('good.csv', 'title,slug\nHello,hello\n');
    const result = await inspect(file, 'good.csv');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.fileName).toBe('good.csv');
      expect(result.size).toBeGreaterThan(0);
    }
  });

  it.each(['data.csv', 'data.tsv', 'data.txt', 'DATA.CSV'])('accepts %s', async (name) => {
    const file = await writeFile(name, 'a,b\n1,2\n');
    expect((await inspect(file, name)).ok).toBe(true);
  });

  it('refuses when no file was sent', async () => {
    const result = await inspectUpload(undefined, { maxFileSizeMb: 50 });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('no_file');
  });

  it.each(['payload.exe', 'sheet.xlsx', 'notes.pdf', 'archive.zip', 'noext'])(
    'refuses the extension of %s',
    async (name) => {
      const file = await writeFile('body.csv', 'a,b\n');
      const result = await inspect(file, name);

      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.code).toBe('extension_not_allowed');
    }
  );

  it('refuses a double extension', async () => {
    const file = await writeFile('double.csv', 'a,b\n');
    const result = await inspect(file, 'payload.exe.csv');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('double_extension');
  });

  it('refuses a file over the size limit and names the limit', async () => {
    const file = await writeFile('big.csv', Buffer.alloc(2 * 1024 * 1024, 0x61));
    const result = await inspect(file, 'big.csv', 1);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('file_too_large');
      expect(result.message).toContain('1 MB');
    }
  });

  it('refuses an empty file', async () => {
    const file = await writeFile('empty.csv', '');
    const result = await inspect(file, 'empty.csv');

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('file_empty');
  });

  it.each([
    ['xlsx', Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]), 'workbook'],
    ['legacy xls', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1]), 'Excel'],
    ['pdf', Buffer.from('%PDF-1.7\n'), 'PDF'],
    ['gzip', Buffer.from([0x1f, 0x8b, 0x08, 0x00]), 'gzip'],
  ])('refuses a %s renamed to .csv', async (label, bytes, expected) => {
    const file = await writeFile(`${label.replace(/\s/g, '-')}.csv`, bytes);
    const result = await inspect(file, 'renamed.csv');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('not_a_csv');
      expect(result.message).toContain(expected);
    }
  });

  it('refuses a UTF-16 file and says how to fix it', async () => {
    const file = await writeFile('utf16.csv', Buffer.from('title,slug\n', 'utf16le'));
    const result = await inspect(file, 'utf16.csv');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.code).toBe('not_utf8');
      expect(result.message).toContain('CSV UTF-8');
    }
  });

  it('reads the formidable v1 `path` field as well as `filepath`', async () => {
    const file = await writeFile('legacy-field.csv', 'a,b\n1,2\n');
    const result = await inspectUpload(
      { path: file, name: 'legacy-field.csv' },
      { maxFileSizeMb: 50 }
    );

    expect(result.ok).toBe(true);
  });

  it('falls back to stat when the upload reports no size', async () => {
    const file = await writeFile('nosize.csv', 'a,b\n1,2\n');
    const result = await inspectUpload(
      { filepath: file, originalFilename: 'nosize.csv' },
      { maxFileSizeMb: 50 }
    );

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.size).toBe(8);
  });
});
