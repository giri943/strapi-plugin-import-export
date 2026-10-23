# strapi-plugin-csv-import-export

Bulk CSV import and export for Strapi 5, built around your own content types.

[![npm version](https://img.shields.io/npm/v/strapi-plugin-csv-import-export.svg)](https://www.npmjs.com/package/strapi-plugin-csv-import-export)
[![downloads](https://img.shields.io/npm/dm/strapi-plugin-csv-import-export.svg)](https://www.npmjs.com/package/strapi-plugin-csv-import-export)
[![licence](https://img.shields.io/npm/l/strapi-plugin-csv-import-export.svg)](./LICENSE)

Someone sends you a spreadsheet of 4,000 products and asks you to get it into Strapi by Friday.
You could write the script, but then you own the validation, the relation lookups, the
partial-failure handling, and the question of who is allowed to run it.

This plugin does that in the admin panel instead. It reads your schema, gives the content team a
template that matches it, checks their file before anything is written, and says exactly which row
went wrong and why.

## What you get

- **A template generated from your schema**, so the columns stay right when you add a field
- **A dry run that writes nothing**, with a per-row report you can download as CSV
- **Readable relations.** A category column shows `News`, not `k2m9x7p…`
- **Filters and column choice on export**, so you can hand someone a two-column sheet
- **Permissions that start closed.** Nothing is importable until an admin switches it on for a role
- **Streaming**, so a 200,000-row file does not take the server down

## Install

```bash
yarn add strapi-plugin-csv-import-export && yarn build
```

```bash
npm install strapi-plugin-csv-import-export && npm run build
```

```bash
pnpm add strapi-plugin-csv-import-export && pnpm build
```

**Do not skip the build.** The plugin ships React components that have to be compiled into your
admin bundle. Skip it and the CSV menu never appears, with no error to tell you why.

One quirk: the npm package is `strapi-plugin-csv-import-export`, but the plugin is called
**`strapi-import-export`**. That shorter name is the key in `config/plugins.ts` and the prefix of
every route and permission.

| | |
|---|---|
| Strapi | 5.x only (`^5.0.0`) |
| Node | 18, 20, 22 |
| Databases | SQLite, PostgreSQL, MySQL / MariaDB |

Strapi v4 is not supported. It [reached end of life on 30 April 2026](https://docs.strapi.io/cms/migration/v4-to-v5/introduction-and-faq)
and its admin panel needs a different design system, so supporting it would mean a second admin
bundle rather than a shim.

## Switch it on

Three things have to line up before a button appears. That is on purpose: a bulk import endpoint
that works out of the box is a data-loss incident waiting for a quiet Friday afternoon.

1. **Give a role the plugin permissions.** Settings → Administration Panel → Roles → enable the
   actions under **CSV Import & Export**.
2. **Enable the collections.** Settings → CSV Import & Export → Configuration. Import and export
   are switched on separately per collection.
3. **Grant those collections to roles.** Same page, under **Role access**. Super admins are
   granted automatically so you cannot lock yourself out.

Now open an enabled collection in the Content Manager. A **CSV** menu sits above the table.

A user also needs the matching Content Manager rights on the collection. Someone who cannot read
Article there cannot export it here either, so the plugin is never a way around permissions you
have already set.

## Importing

1. **CSV → Import from CSV**
2. Download the template, fill it in, save as **CSV UTF-8**
3. Upload and press **Check the file**. Nothing is written yet
4. Read the report. If it is clean, press **Import**

The Import button stays disabled until a validation run comes back clean, so nobody can click past
a broken header.

Rows are matched on the collection's identifier column, `documentId` by default:

| Mode | Row exists | Row is new |
|---|---|---|
| `upsert` (default) | updated | created |
| `create-only` | fails with `duplicate` | created |
| `update-only` | updated | fails with `not_found` |
| `skip-duplicates` | skipped quietly | created |

**The empty-cell rule catches people out, so here it is plainly.** A column that is there but
empty clears that field. A column missing from the file is left alone. So a file of just
`documentId,title` updates titles and touches nothing else.

Validation runs before any write, so a bad row never reaches the database. Writes then go in
batches inside a transaction; if a batch is rejected it rolls back and the rows are retried one at
a time, so only the genuinely bad rows fail. Large files run in the background and you can close
the dialog.

## Exporting

**CSV → Export to CSV.**

Pick which rows with one filter per relation plus a date range on `createdAt`, `updatedAt` or
`publishedAt`. Several values in one filter mean "any of these"; several filters all have to match.
Tick rows in the List View first and the export covers exactly those.

Pick which columns by ticking them; tick nothing and you get everything. Your choice is remembered
per collection and also drives the template download, so you can hand someone a narrow sheet
instead of explaining which of forty columns to ignore.

Rows are streamed and paged, so memory use does not grow with the collection. Fields your role
cannot read are left out, and `password` and `private` fields never appear.

## The CSV format

| Structure | Header | Example cell |
|---|---|---|
| Scalar | `title` | `Hello world` |
| Component | `seo.metaTitle` | `Hello world` |
| Repeatable component | `faq[0].question` | `Why?` |
| Relation | `category:documentId` | `k2m9x…` |
| Relation label (read only) | `category:name` | `News` |
| Many relation | `tags:documentId` | `k2m9x…;p4r7y…` |
| Media | `cover:name` | `hero.webp` |
| Dynamic zone | `sections` | `[{"__component":"blocks.hero"}]` |
| Draft & publish | `status` | `draft` or `published` |

Relations get **two** columns on export so the file is readable by a person and re-importable by a
machine: `category:documentId` is what an import matches on, and `category:name` is there so you
can see what the row points at. You can match on a readable field like `slug` instead, as long as
it identifies a single entry.

Full details, including the quoting rules and how to match on your own field, in
**[docs/csv-format.md](docs/csv-format.md)**.

## Documentation

| | |
|---|---|
| [CSV format](docs/csv-format.md) | Every column shape, quoting, empty cells, limits |
| [Configuration](docs/configuration.md) | The six permissions and every setting |
| [Security](docs/security.md) | What is hardened, and the known limitations |
| [Export API](docs/api.md) | Calling the export endpoint directly |
| [Contributing](CONTRIBUTING.md) | Local development and the test suites |

## Licence

MIT
