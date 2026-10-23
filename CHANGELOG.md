# Changelog

This project follows [semantic versioning](https://semver.org/). A change in the supported Strapi
major version is always a major release here.

## Naming note

The npm package is **`strapi-plugin-csv-import-export`**. The shorter
`strapi-plugin-import-export` was published by someone else in 2021 and fully unpublished, and npm
permanently reserves an unpublished name: a publish attempt returns `403 Forbidden`, so the name
can never be claimed by anyone.

The plugin's own identifier is unaffected and remains **`strapi-import-export`**. That is the key
in `config/plugins.js`, the prefix of every route (`/strapi-import-export/...`), and the namespace
of every permission (`plugin::strapi-import-export.*`). Renaming the npm package therefore changes
nothing for an existing installation.

## [0.1.1] — 2026-10-23

Documentation and metadata only. The published code is identical to `0.1.0`.

### Fixed

- The permissions table in the README listed action ids that no longer exist (`config.read`,
  `import.run`, `job.read` and so on). The real ids are `read-config`, `update-config`,
  `download-template`, `run-import`, `run-export` and `read-history`. Anyone following the old
  table was looking for permissions that are not there.
- The contributing section claimed 316 unit tests. There are 439, plus 45 integration tests.

### Changed

- Shortened the npm `description` from 183 characters to 121, so it is not truncated in npm
  search results.
- Rewrote the README: it now opens with the problem the plugin solves rather than a feature
  summary, gains a short feature list, and moves the local-development and troubleshooting
  material out from between "Install" and "Switching it on" into collapsed sections under
  Contributing.
- Documented why exported cells containing a space or colon are quoted.

### Added

- Logo assets in `assets/`: a detailed square icon, a simplified mark that stays legible down to
  32 px, a horizontal wordmark, and PNG renders of each.

## [0.1.0] — 2026-10-23

First published release.

### Added

- **Readable relation columns.** Every relation now exports two columns: `category:documentId`
  for matching and a read-only `category:name` so the file can be read by a person. The label
  field is guessed from the usual names and is configurable per target collection, including off.
  Uniqueness is not required of a label, which is the point — a category `name` is normally not
  unique and so could never be used as a match key.
- **Export filters.** One filter per relation plus a date range on `createdAt`, `updatedAt` or
  `publishedAt`. Several values in a filter mean "any of"; several filters all have to match. The
  payload is a field name and a list of ids rather than a Strapi filter object, and the dropdown
  values come from an endpoint that only lists collections the caller may read.
- **Column selection.** Choose which columns an export or a template contains. The choice is
  remembered per collection, and deselecting the identifier column warns that the file can no
  longer be used for updates.
- A **Relations → Configure** dialog on the settings page for the match key and label field of
  each related collection.
- CSV import and export for Strapi 5 collection types, reached from a **CSV** menu in the Content
  Manager List View.
- Template and column-guide downloads generated from the live schema.
- Column support for scalars, single and repeatable components, dynamic zones (as JSON),
  relations and media matched on a configurable key, i18n locales and draft & publish status.
- Validation pass with a per-row report, downloadable as CSV, and a dry run that writes nothing.
- Import modes `upsert`, `create-only`, `update-only` and `skip-duplicates`.
- Two-layer access control: six Strapi RBAC actions plus a per-collection, per-role allow-list
  that is empty by default. Every request also re-checks the caller's own Content Manager rights.
- Background import jobs with progress, history and retention, surfaced on the plugin page.
- Streaming export and import so memory use does not grow with file size.
- Configuration page for collections, role grants, CSV format and limits.
- `playground/` example app whose `Article` type carries one of every supported attribute kind.

### Fixed

- A cell containing a space, colon, semicolon, pipe or tab is now always quoted on export. A
  one-column file holds no commas, so a spreadsheet opening it falls back to guessing the
  separator: LibreOffice tries whitespace and a colon, which split `Girish Soman` across two
  cells and cut the header `category:name` in half. Numbers stay unquoted so they are still read
  as numbers. Applies to exports, templates, the column guide and the error report.
- Every CSV download (template, column guide, export, error report) failed in the browser with
  `Failed to execute 'createObjectURL' on 'URL': Overload resolution failed`. Strapi's fetch
  client `post` does not forward `responseType` to its response interceptor, so a `text/csv`
  body was run through `response.json()`, the resulting `SyntaxError` was swallowed as "empty
  body", and the caller received `{}` instead of a `Blob`. Downloads now read the response body
  themselves, which also lets a JSON error response be reported as a message instead of being
  saved to disk as a broken CSV.
- Permission action ids are single hyphenated segments (`run-import` rather than `import.run`).
  The admin panel derives each permission flag from the **last dot-separated segment** of the
  action id, so `config.read` and `job.read` both became `canRead`, and `import.run` and
  `export.run` both became `canRun`. Every flag the panel exposed therefore differed from the one
  the components read, which left the plugin page spinning forever and hid the CSV menu in the
  Content Manager entirely.
- Menu and settings links use a non-async component loader, clearing Strapi's deprecation warning.
- `@strapi/utils` is declared as a peer dependency so the bundler leaves it external. It was
  previously inlined, which both bloated the server bundle from 121 kB to 816 kB and broke
  Strapi's `instanceof` checks, turning every validation error into a 500.
- Access refusals throw `PolicyError` rather than `ForbiddenError`. Strapi's authorize middleware
  replaces a `ForbiddenError` message with a bare "Forbidden" and treats `PolicyError` as the one
  exception whose message reaches the client, so administrators now see which gate refused them.

### Security

- CSV injection neutralised on export, with plain numbers left intact.
- Uploads validated on extension, size and magic bytes; renamed workbooks, PDFs, gzip archives
  and UTF-16 files are refused with an explanation.
- Prototype-pollution headers and JSON keys rejected rather than sanitised.
- `password` and `private` attributes never leave the server, including through component paths.
- Credential, token and RBAC tables cannot be added to the allow-list.
- Uploaded files staged outside the project under a random name and deleted after every run.
- Application log carries counts and row numbers, never cell values.
