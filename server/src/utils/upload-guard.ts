import { promises as fs } from 'node:fs';
import path from 'node:path';

export const ALLOWED_EXTENSIONS = ['.csv', '.tsv', '.txt'] as const;

export interface UploadedFile {
  /** formidable v2+ uses `filepath`; older builds and some proxies still send `path`. */
  filepath?: string;
  path?: string;
  originalFilename?: string | null;
  name?: string | null;
  size?: number;
  mimetype?: string | null;
  type?: string | null;
}

export type UploadCheck =
  | { ok: true; filePath: string; fileName: string; size: number }
  | { ok: false; code: string; message: string };

interface BinarySignature {
  bytes: readonly number[];
  label: string;
  advice: string;
}

/**
 * Containers people rename to `.csv` by accident. Caught by content rather than by extension,
 * because the extension is exactly the part that is wrong.
 */
const BINARY_SIGNATURES: readonly BinarySignature[] = [
  {
    bytes: [0x50, 0x4b, 0x03, 0x04],
    label: 'a ZIP-based workbook (xlsx, ods or numbers)',
    advice: 'Open it in your spreadsheet program and choose "CSV UTF-8" when saving.',
  },
  {
    bytes: [0xd0, 0xcf, 0x11, 0xe0],
    label: 'a legacy Excel workbook (xls)',
    advice: 'Open it in Excel and save it again as "CSV UTF-8".',
  },
  {
    bytes: [0x25, 0x50, 0x44, 0x46],
    label: 'a PDF',
    advice: 'Upload the CSV file instead.',
  },
  {
    bytes: [0x1f, 0x8b],
    label: 'a gzip archive',
    advice: 'Extract it and upload the CSV inside.',
  },
];

function resolvePath(file: UploadedFile): string | undefined {
  return file.filepath ?? file.path;
}

function resolveName(file: UploadedFile): string {
  return file.originalFilename ?? file.name ?? 'upload.csv';
}

function startsWith(buffer: Buffer, bytes: readonly number[]): boolean {
  if (buffer.length < bytes.length) return false;

  return bytes.every((byte, index) => buffer[index] === byte);
}

export async function inspectUpload(
  file: UploadedFile | undefined,
  options: { maxFileSizeMb: number }
): Promise<UploadCheck> {
  if (!file) {
    return {
      ok: false,
      code: 'no_file',
      message: 'No file was uploaded. Attach the CSV as the "file" field.',
    };
  }

  const filePath = resolvePath(file);
  if (!filePath) {
    return { ok: false, code: 'no_file_path', message: 'The upload could not be read from disk.' };
  }

  const fileName = resolveName(file);
  const extension = path.extname(fileName).toLowerCase();

  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(extension)) {
    return {
      ok: false,
      code: 'extension_not_allowed',
      message: `"${extension || 'a file with no extension'}" is not accepted. Use one of: ${ALLOWED_EXTENSIONS.join(', ')}.`,
    };
  }

  // Two extensions is the classic way to smuggle one file type past a check on the last one.
  const nameWithoutExtension = path.basename(fileName, extension);
  if (/\.(exe|js|sh|bat|cmd|php|html|svg|zip|xlsx|xls)$/i.test(nameWithoutExtension)) {
    return {
      ok: false,
      code: 'double_extension',
      message: `"${fileName}" carries two extensions. Rename it so it ends in .csv only.`,
    };
  }

  let size = file.size;
  if (size === undefined) {
    const stats = await fs.stat(filePath);
    size = stats.size;
  }

  const limitBytes = options.maxFileSizeMb * 1024 * 1024;
  if (size > limitBytes) {
    return {
      ok: false,
      code: 'file_too_large',
      message: `The file is ${(size / 1024 / 1024).toFixed(1)} MB; the limit is ${options.maxFileSizeMb} MB.`,
    };
  }
  if (size === 0) {
    return { ok: false, code: 'file_empty', message: 'The file is empty.' };
  }

  const head = await readHead(filePath);

  for (const signature of BINARY_SIGNATURES) {
    if (startsWith(head, signature.bytes)) {
      return {
        ok: false,
        code: 'not_a_csv',
        message: `This file is ${signature.label}, not a CSV. ${signature.advice}`,
      };
    }
  }

  if (head.includes(0x00)) {
    return {
      ok: false,
      code: 'not_utf8',
      message:
        'This file contains null bytes, which usually means it was saved as UTF-16 ("Unicode Text"). Save it as "CSV UTF-8" instead.',
    };
  }

  return { ok: true, filePath, fileName, size };
}

async function readHead(filePath: string, byteCount = 4096): Promise<Buffer> {
  const handle = await fs.open(filePath, 'r');

  try {
    const buffer = Buffer.alloc(byteCount);
    const { bytesRead } = await handle.read(buffer, 0, byteCount, 0);

    return buffer.subarray(0, bytesRead);
  } finally {
    await handle.close();
  }
}
