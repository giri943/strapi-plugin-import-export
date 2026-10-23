# Contributing

## Getting set up

```bash
npm install
npm run build
npm test
```

## Trying a build in a real project

One command, run here:

```bash
npm run pack:local -- --install "/path/to/your/strapi-project"
```

It builds, packs a uniquely named tarball, installs it with whichever package manager the target
uses, clears the admin build caches, rebuilds the admin panel, then hashes every installed file and
compares it against the build. Set `IE_INSTALL_TARGET` once and you can drop the path. Add
`--skip-build` for a server-only change.

Restart Strapi afterwards and hard-refresh the browser (Ctrl+Shift+R), because the cached admin
bundle still holds the previous build.

Without `--install` it only packs and prints the commands to run by hand.

**The timestamp in the filename is load-bearing.** Both npm and yarn cache a `file:` tarball by
name and version, so reinstalling the same filename either silently serves the cached copy or
fails an integrity check against the lockfile. Do not "simplify" the script by dropping it.

### Why not `npm link`, `yarn link`, or a folder dependency

Linking creates a symlink, and a plugin loaded from outside the project's `node_modules` resolves
its **own** copy of `@strapi/utils`. Its error classes then fail Strapi's `instanceof` checks, so
every validation error surfaces as a 500 with no message instead of a 400 explaining what is wrong.

A folder dependency (`file:../plugin-folder`) has the same problem and adds another: yarn copies
the whole directory and ignores the `files` field, which measured 1.5 GB and 170,000 files for this
repo, including a second copy of React.

A tarball install has one copy of everything and behaves like a published install.

### If the database driver complains about a Node version

```
The module 'better_sqlite3.node' was compiled against a different Node.js version
using NODE_MODULE_VERSION 115. This version of Node.js requires NODE_MODULE_VERSION 127.
```

Your Node version changed after the native driver was installed. Run `npm rebuild better-sqlite3`
in whichever project reports it. This repo and the playground each have their own copy.

## Running the checks

```bash
npm run check       # typecheck admin, server and tests, then unit tests and build
npm run check:all   # the above plus the integration suite
```

`npm run check` must pass before a pull request. `npm run check:all` boots a real Strapi app on
SQLite and takes a little longer; run it when you change anything that touches the Document
Service, transactions, schema discovery or the export query.

## Where things live

| Path | Contents |
|---|---|
| `server/src/core/` | Schema discovery, the column grammar, CSV codec, coercion. No Strapi globals, unit tested in isolation. |
| `server/src/services/` | Everything that talks to Strapi: settings, RBAC, template, export, import, jobs. |
| `server/src/policies/` | The access gates applied to routes. |
| `admin/src/` | The admin panel: configuration page, job history, Content Manager dialogs. |
| `server/tests/` | Unit tests with fakes. |
| `server/tests/integration/` | Tests that boot the playground app against SQLite. |
| `playground/` | Example Strapi app used by hand and by the integration tests. |

Prefer putting logic in `core/` when it does not need Strapi. That is where the behaviour is
cheapest to test and where most of the bugs would otherwise hide.

## Conventions

- TypeScript with `strict` on. The Strapi tsconfig preset ships `strict: false`, which quietly
  breaks narrowing on the `{ ok: true } | { ok: false }` result shape used throughout, so this
  package overrides it.
- Comment only where the code cannot explain itself: a workaround for third-party behaviour, a
  deliberate ordering constraint, a value that looks wrong but is correct.
- Error messages are read by content editors. Say what is wrong and what to do about it.
- Never log cell values. Row numbers, column names and error codes only.

## Adding support for an attribute type

1. Add coercion in `server/src/core/coerce.ts` with tests for the accepted and rejected forms.
2. Add column generation in `server/src/core/schema.ts`.
3. Add rendering in `server/src/core/render-row.ts`.
4. Add the attribute to the playground `Article` schema and assert a round trip in
   `server/tests/integration/round-trip.test.ts`.

Step 4 matters: a type that round-trips in a unit test but not against a real database is not
supported.

## Releasing

1. Update `CHANGELOG.md`.
2. `npm version patch` (or `minor` / `major`), which commits and tags.
3. `npm run check:all`.
4. `npm publish --access public`. `prepublishOnly` rebuilds the bundles.

`--provenance` only works from a public repository, so the release workflow adds it conditionally.
Pushing a `v*` tag runs the workflow, which publishes if `NPM_TOKEN` is set as a repository secret.
Do not both publish by hand and push the tag, or the workflow fails on a version that already
exists.
