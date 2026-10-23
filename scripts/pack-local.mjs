#!/usr/bin/env node
/**
 * Builds the plugin and writes a uniquely named tarball for installing into a local project.
 *
 * The unique name is the point. Both npm and yarn cache a `file:` tarball under its
 * package name and version, so installing a rebuilt `strapi-plugin-import-export-0.1.0.tgz`
 * over the top of itself does one of three unhelpful things:
 *
 *   - reports success and silently installs the previously cached copy,
 *   - fails with `error Integrity check failed` once the lockfile hash no longer matches,
 *   - or, with yarn, does either of those depending on the state of its cache.
 *
 * A filename that has never been seen before sidesteps all of it: new resolution, new lockfile
 * entry, no cache hit. Verified against yarn 1.22 and npm 10.
 */
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

const run = (command, args) =>
  execFileSync(command, args, { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });

const capture = (command, args) =>
  execFileSync(command, args, { cwd: root, encoding: 'utf8', shell: process.platform === 'win32' });

console.log('Building…');
run('npx', ['strapi-plugin', 'build']);

const staging = path.join(os.tmpdir(), 'strapi-plugin-import-export-packs');
mkdirSync(staging, { recursive: true });

console.log('Packing…');
const packOutput = capture('npm', ['pack', '--json', '--pack-destination', staging]);
const packed = JSON.parse(packOutput.slice(packOutput.indexOf('[')))[0].filename;
const packedPath = path.join(staging, packed);

const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const uniqueName = `${pkg.name}-${pkg.version}-${stamp}.tgz`;
const uniquePath = path.join(staging, uniqueName);

copyFileSync(packedPath, uniquePath);
rmSync(packedPath, { force: true });

console.log('');
console.log(`Built ${pkg.name}@${pkg.version}`);
console.log(uniquePath);
console.log('');
console.log('Install it into your Strapi project with one of:');
console.log('');
console.log(`  yarn add "file:${uniquePath}" && yarn build`);
console.log(`  npm install "${uniquePath}" && npm run build`);
console.log('');
console.log('Then restart Strapi and hard-refresh the browser (Ctrl+Shift+R).');
