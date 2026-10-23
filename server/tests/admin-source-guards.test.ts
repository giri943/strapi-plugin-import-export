import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Source-level guards for the admin panel.
 *
 * The bugs these cover are only reachable in a browser, so a normal unit test cannot see them.
 * Reading the source is a blunt instrument, but each of these was a real defect that shipped and
 * produced a confusing symptom, and the cost of catching them here is a few string checks.
 */

const adminSrc = (file: string) =>
  readFileSync(path.join(__dirname, '..', '..', 'admin', 'src', file), 'utf8');

/**
 * Strips comments so a guard cannot be tripped by the comment that explains the guard. Crude,
 * but these files contain no regex literals or strings that would confuse it.
 */
const codeOnly = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

describe('file downloads', () => {
  const download = adminSrc('utils/download.ts');

  /**
   * Strapi's fetch client `post` does not forward `responseType` to its response interceptor, so
   * a `text/csv` body is parsed with `response.json()`, the SyntaxError is swallowed as "empty
   * body", and the caller gets `{}`. Handing that to `URL.createObjectURL` fails with
   * "Overload resolution failed", which is what every download did before this guard existed.
   */
  it('does not route downloads through Strapi\'s fetch client', () => {
    const code = codeOnly(download);

    expect(code).not.toContain('getFetchClient');
    expect(code).not.toContain('useFetchClient');
  });

  it('reads the response body as a blob itself', () => {
    expect(download).toContain('response.blob()');
  });

  it('rejects a non-ok response instead of saving the error as a CSV', () => {
    expect(download).toContain('response.ok');
  });

  it('rejects an empty body rather than saving a zero-byte file', () => {
    expect(download).toContain('blob.size === 0');
  });

  it('sends the admin bearer token', () => {
    expect(download).toContain('Authorization');
    expect(download).toContain('useAuth');
  });

  it('honours a separate backend origin', () => {
    expect(download).toContain('backendURL');
  });
});

describe('the components that download files', () => {
  it.each(['components/ImportDialog.tsx', 'components/ExportDialog.tsx', 'components/JobReport.tsx'])(
    '%s uses the download hook',
    (file) => {
      expect(adminSrc(file)).toContain('useCsvDownload');
    }
  );
});

describe('plugin entry point', () => {
  const entry = adminSrc('index.ts');

  /**
   * Strapi warns when a menu or settings link is given an `async` component loader, because it
   * checks `Component[Symbol.toStringTag] === 'AsyncFunction'`. It wants a plain function
   * returning a dynamic import whose module has a `default`.
   */
  it('registers links with a non-async component loader', () => {
    expect(entry).not.toMatch(/Component:\s*async/);
    expect(entry).toContain('.then((mod) =>');
  });

  it('declares a relative menu path', () => {
    // A leading slash makes Strapi rewrite the path and warn about it.
    expect(entry).not.toMatch(/to:\s*[`'"]\//);
  });
});

describe('the local packing script', () => {
  const script = readFileSync(
    path.join(__dirname, '..', '..', 'scripts', 'pack-local.mjs'),
    'utf8'
  );

  /**
   * npm and yarn both cache a `file:` tarball under its name and version, so reusing a filename
   * either installs a stale copy or fails an integrity check. The timestamp is what makes a
   * local reinstall reflect the build.
   */
  it('writes a uniquely named tarball', () => {
    expect(codeOnly(script)).toContain('stamp');
    expect(codeOnly(script)).toMatch(/\$\{pkg\.name\}-\$\{pkg\.version\}-\$\{stamp\}/);
  });

  it('builds before packing', () => {
    const code = codeOnly(script);
    expect(code.indexOf("'build'")).toBeGreaterThan(-1);
    expect(code.indexOf("'build'")).toBeLessThan(code.indexOf("'pack'"));
  });

  it('prints both a yarn and an npm command', () => {
    expect(script).toContain('yarn add');
    expect(script).toContain('npm install');
  });

  it('can install into a target project in the same run', () => {
    const code = codeOnly(script);

    expect(code).toContain("flag('install')");
    expect(code).toContain('IE_INSTALL_TARGET');
  });

  it('picks the package manager from the target lockfile', () => {
    const code = codeOnly(script);

    expect(code).toContain('yarn.lock');
    expect(code).toContain('pnpm-lock.yaml');
  });

  /**
   * A replaced plugin can still be served from Vite's pre-bundled dependency cache, which is
   * keyed on resolved paths rather than on file contents.
   */
  it('clears the admin build caches after installing', () => {
    const code = codeOnly(script);

    expect(code).toContain("'.strapi', 'vite'");
    expect(code).toContain("'.strapi', 'client'");
  });

  /**
   * A cache hit is silent: the install reports success having unpacked an older copy. Hashing
   * every file is what turns that into a failure instead of a confusing debugging session.
   */
  it('fails when the installed files do not match the build', () => {
    const code = codeOnly(script);

    expect(code).toContain('sha256');
    expect(code).toContain('process.exit(1)');
  });
});

describe('permission flags read by components', () => {
  const permissions = adminSrc('permissions.ts');

  it('are read through the shared RBAC_FLAGS map', () => {
    expect(permissions).toContain('RBAC_FLAGS');
  });

  it.each([
    'components/ListViewActions.tsx',
    'pages/HomePage.tsx',
    'pages/SettingsPage.tsx',
  ])('%s does not hardcode a canX flag name', (file) => {
    const source = adminSrc(file);

    // Hardcoding `allowedActions.canSomething` is how the flags silently drifted from the
    // action ids and hid every control in the panel.
    expect(source).not.toMatch(/allowedActions\.can[A-Z]/);
  });
});
