import { createReadStream, promises as fs } from 'node:fs';
import { randomBytes } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { PLUGIN_NAME } from '../constants';
import { firstLineOf } from '../core/csv';

const TEMP_PREFIX = 'strapi-import-export-';

/**
 * Copies an upload into the OS temp directory under a random name.
 *
 * The file never lands inside the project, so it can never be served over HTTP, and the random
 * name means a second concurrent import cannot guess or clobber it.
 */
export async function stageUpload(sourcePath: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), TEMP_PREFIX));
  const target = path.join(directory, `${randomBytes(16).toString('hex')}.csv`);

  await fs.copyFile(sourcePath, target);

  return target;
}

export async function discardStagedFile(filePath: string | undefined): Promise<void> {
  if (!filePath) return;

  try {
    // Retries cover Windows, where the read stream's handle can still be closing when the
    // import finishes and the first rmdir fails with ENOTEMPTY.
    await fs.rm(path.dirname(filePath), {
      recursive: true,
      force: true,
      maxRetries: 5,
      retryDelay: 50,
    });
  } catch {
    // A temp file the OS will reclaim anyway is not worth failing a completed import over.
  }
}

/** Removes temp directories this plugin created, used on boot and shutdown. */
export async function discardAllStagedFiles(): Promise<number> {
  let removed = 0;

  try {
    const entries = await fs.readdir(os.tmpdir(), { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory() || !entry.name.startsWith(TEMP_PREFIX)) continue;

      try {
        await fs.rm(path.join(os.tmpdir(), entry.name), {
          recursive: true,
          force: true,
          maxRetries: 3,
          retryDelay: 50,
        });
        removed += 1;
      } catch {
        // Another process may still own it; leave it alone.
      }
    }
  } catch {
    return removed;
  }

  return removed;
}

/** Reads just enough of the file to sniff the delimiter without loading the whole thing. */
export async function readFirstLine(filePath: string, byteLimit = 64 * 1024): Promise<string> {
  const handle = await fs.open(filePath, 'r');

  try {
    const buffer = Buffer.alloc(byteLimit);
    const { bytesRead } = await handle.read(buffer, 0, byteLimit, 0);

    return firstLineOf(buffer.subarray(0, bytesRead).toString('utf8'));
  } finally {
    await handle.close();
  }
}

export function openCsvStream(filePath: string) {
  return createReadStream(filePath, { encoding: 'utf8' });
}

export async function fileSizeOf(filePath: string): Promise<number> {
  const stats = await fs.stat(filePath);
  return stats.size;
}

export const TEMP_DIRECTORY_PREFIX = TEMP_PREFIX;
export const TEMP_OWNER = PLUGIN_NAME;
