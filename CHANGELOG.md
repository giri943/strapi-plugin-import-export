# Changelog

This project follows [semantic versioning](https://semver.org/). A change in the supported Strapi
major version is always a major release here.

## Versioning note

`strapi-plugin-import-export` was published by someone else in 2021 and fully unpublished. npm
permanently reserves the version numbers that were used, so **`1.0.0` and `1.0.1` can never be
published again**. This package therefore uses `0.x` while it stabilises and its first stable
release will be `1.1.0`.

## [Unreleased]

### Added

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
