# Contributing

## Getting set up

```bash
npm install
npm run build
npm test
```

## Trying a build in a real project

```bash
npm run pack:local
```

It builds, packs to a timestamped filename in the OS temp directory, and prints the `npm install`
and `yarn add` commands to paste into your Strapi project.

The timestamp is load-bearing. Both package managers cache a `file:` tarball by name and version,
so reinstalling the same filename either silently serves the cached copy or fails an integrity
check against the lockfile. Do not "simplify" the script by dropping it.

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
2. Bump the version. Note that `1.0.0` and `1.0.1` are permanently unavailable on npm; see the
   changelog for why.
3. `npm run check:all`.
4. `npm publish --access public --provenance`. `prepublishOnly` rebuilds the bundles.
