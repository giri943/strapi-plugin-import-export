import { useCallback } from 'react';
import { useAuth } from '@strapi/strapi/admin';
import { PLUGIN_ID } from '../pluginId';

/**
 * File downloads go through `fetch` directly rather than through Strapi's fetch client.
 *
 * The client's `post` does not forward `responseType` to its response interceptor
 * (`getFetchClient.js` calls `responseInterceptor(response, options?.validateStatus)` with no
 * third argument), so a `text/csv` body is run through `response.json()`, the resulting
 * `SyntaxError` is swallowed as "empty body", and `data` comes back as `{}`. Passing that to
 * `URL.createObjectURL` fails with "Overload resolution failed".
 *
 * Reading the body here as a blob also lets a JSON error response be reported as a message
 * instead of being saved to disk as a broken CSV.
 */

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);

  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Revoked on a later tick; revoking synchronously cancels the download in Safari.
    window.setTimeout(() => URL.revokeObjectURL(url), 2_000);
  }
}

function nameFromHeaders(headers: Headers, fallback: string): string {
  const disposition = headers.get('content-disposition');
  if (!disposition) return fallback;

  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(disposition);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1].trim());
    } catch {
      return fallback;
    }
  }

  const plain = /filename="?([^";]+)"?/i.exec(disposition);
  return plain?.[1]?.trim() ?? fallback;
}

/** Strapi serves the admin panel and the API from the same origin unless told otherwise. */
function absoluteUrl(path: string): string {
  const configured = (window as { strapi?: { backendURL?: string } }).strapi?.backendURL ?? '';
  const base = configured.replace(/\/$/, '');

  return `${base}${path.startsWith('/') ? path : `/${path}`}`;
}

async function readErrorMessage(response: Response): Promise<string> {
  const fallback = `The request failed with status ${response.status}.`;

  try {
    const text = await response.text();
    if (text.length === 0) return fallback;

    const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
    return parsed.error?.message ?? parsed.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function suggestFileName(uid: string, suffix: string): string {
  const base = uid.replace(/[^A-Za-z0-9._-]/g, '-');
  return `${base}-${suffix}.csv`;
}

export function exportFileName(uid: string): string {
  const base = uid.replace(/[^A-Za-z0-9._-]/g, '-');
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  return `${base}-${stamp}.csv`;
}

export const endpointPaths = {
  template: (uid: string) => `/${PLUGIN_ID}/content/${encodeURIComponent(uid)}/template`,
  guide: (uid: string) => `/${PLUGIN_ID}/content/${encodeURIComponent(uid)}/template?guide=1`,
  export: (uid: string) => `/${PLUGIN_ID}/content/${encodeURIComponent(uid)}/export`,
  jobErrors: (jobId: string) => `/${PLUGIN_ID}/jobs/${encodeURIComponent(jobId)}/errors`,
};

export interface CsvDownloader {
  download(path: string, fallbackName: string): Promise<void>;
  downloadWithBody(path: string, body: unknown, fallbackName: string): Promise<void>;
}

export function useCsvDownload(): CsvDownloader {
  const token = useAuth('useCsvDownload', (state) => state.token);

  const run = useCallback(
    async (path: string, init: RequestInit, fallbackName: string) => {
      const headers = new Headers(init.headers);
      headers.set('Accept', 'text/csv, application/json');
      if (token) headers.set('Authorization', `Bearer ${token}`);

      const response = await fetch(absoluteUrl(path), {
        ...init,
        headers,
        // Covers the cookie-based session Strapi uses when "remember me" is off.
        credentials: 'include',
      });

      if (!response.ok) {
        throw new Error(await readErrorMessage(response));
      }

      const blob = await response.blob();
      if (blob.size === 0) {
        throw new Error('The server returned an empty file.');
      }

      saveBlob(blob, nameFromHeaders(response.headers, fallbackName));
    },
    [token]
  );

  const download = useCallback(
    (path: string, fallbackName: string) => run(path, { method: 'GET' }, fallbackName),
    [run]
  );

  const downloadWithBody = useCallback(
    (path: string, body: unknown, fallbackName: string) =>
      run(
        path,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body ?? {}),
        },
        fallbackName
      ),
    [run]
  );

  return { download, downloadWithBody };
}
