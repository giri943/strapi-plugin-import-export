# strapi-plugin-csv-import-export

Bulk CSV import and export for Strapi 5, built around your own content types.

[![npm version](https://img.shields.io/npm/v/strapi-plugin-csv-import-export.svg)](https://www.npmjs.com/package/strapi-plugin-csv-import-export)
[![downloads](https://img.shields.io/npm/dm/strapi-plugin-csv-import-export.svg)](https://www.npmjs.com/package/strapi-plugin-csv-import-export)
[![licence](https://img.shields.io/npm/l/strapi-plugin-csv-import-export.svg)](./LICENSE)

## The problem this solves

Someone sends you a spreadsheet with 4,000 products in it and asks you to get them into Strapi by
Friday. Or a client wants last quarter's enquiries in Excel, and you find yourself writing a
one-off script again.

You could write that script. But then you own it: the validation, the relation lookups, the
partial-failure handling, and the question of who is allowed to run it.

This plugin does that work in the admin panel. It reads your schema, hands the content team a
template that matches it, checks their file before anything is written, and tells them exactly
which row went wrong and why.

## What you get

- **A template generated from your schema**, so the columns are always right, even after you add a
  field
- **A dry run that writes nothing**, with a per-row report you can download as CSV
- **Readable relations.** A category column shows `News`, not `k2m9x7p…`
- **Filters and column choice on export**, so you can hand someone a two-column sheet instead of
  a forty-column dump
- **Permissions that start closed.** No collection is importable or exportable until an
  administrator switches it on for a specific role
- **Streaming**, so a 200,000-row file does not take the server down

## Supported versions

| | |
|---|---|
| Strapi | **5.x only** (`@strapi/strapi` `^5.0.0`) |
| Node | 18, 20, 22 |
| Databases | SQLite, PostgreSQL, MySQL / MariaDB |

Strapi v4 is not supported. It [reached end of life on 30 April 2026](https://docs.strapi.io/cms/migration/v4-to-v5/introduction-and-faq),
and its admin panel uses a different design system and a different Content Manager extension API.
Supporting it would mean shipping a second admin bundle rather than a compatibility shim.

## Install

```bash
# yarn
yarn add strapi-plugin-csv-import-export
yarn build
yarn develop
```

```bash
# npm
npm install strapi-plugin-csv-import-export
npm run build
npm run develop
```

```bash
# pnpm
pnpm add strapi-plugin-csv-import-export
pnpm build
pnpm develop
```

**Do not skip the build step.** The plugin ships React components that have to be compiled into
your admin bundle. Skip it and the CSV menu simply never appears, with no error to tell you why.

One naming quirk worth knowing: the npm package is `strapi-plugin-csv-import-export`, but the
plugin itself is called **`strapi-import-export`**. That shorter name is the key in
`config/plugins.ts`, the prefix of every route, and the namespace of every permission.

The plugin is enabled as soon as it is installed. You only need a config block if you want to seed
settings:

```ts
export default () => ({
  'strapi-import-export': {
    enabled: true,
    config: {
      csvDelimiter: ',',
      multiValueDelimiter: ';',
      maxFileSizeMb: 50,
      maxRows: 200_000,
    },
  },
});
```

## Switching it on

Three things have to line up before any button appears. That is on purpose. A bulk import endpoint
that works out of the box is a data-loss incident waiting for a quiet Friday afternoon.

1. **Give the role the plugin permissions.** Settings → Administration Panel → Roles → pick a role
   → enable the actions under **CSV Import & Export**.
2. **Enable the collections.** Settings → CSV Import & Export → Configuration. Switch on the
   collections you want, and choose import and export separately for each.
3. **Grant those collections to roles.** Same page, under **Role access**. Super admins are
   granted automatically so you cannot lock yourself out.

Now open any enabled collection in the Content Manager. A **CSV** menu sits above the table.

### The permissions

| Permission | What it allows |
|---|---|
| `read-config` | View the configuration page |
| `update-config` | Change allowed collections and role grants |
| `download-template` | Download CSV templates and the column guide |
| `run-import` | Run validations and imports |
| `run-export` | Export a collection to CSV |
| `read-history` | View import history and validation reports |

On top of these, a user needs the matching **Content Manager** rights on the collection itself.
If someone cannot read Article in the Content Manager, they cannot export it here either, no
matter what the plugin settings say. The plugin can never be used as a way around permissions you
have already set.

## Importing

1. Open the **CSV** menu and choose **Import from CSV**.
2. Download the template, fill it in, save as **CSV UTF-8**.
3. Upload it and press **Check the file**. Nothing is written yet.
4. Read the report. If it is clean, press **Import**.

The Import button stays disabled until a validation run comes back clean, so nobody can click
past a broken header.

### Rows that already exist

Rows are matched on the identifier column you configured for the collection, `documentId` by
default.

| Mode | Row exists | Row is new |
|---|---|---|
| `upsert` (default) | updated | created |
| `create-only` | **fails** with `duplicate` | created |
| `update-only` | updated | **fails** with `not_found` |
| `skip-duplicates` | skipped quietly | created |

### Empty cells

This is the rule that catches people out, so here it is plainly:

- **A column that is there but empty clears that field.**
- **A column that is missing from the file is left alone.**

So a file with just `documentId,title` updates titles and touches nothing else. The file is the
source of truth for the columns it contains, and only those.

### When rows fail

Validation runs before anything is written, so a row with a bad value never reaches the database
and never affects the rows around it.

Writes go in batches inside a transaction. If the database rejects a batch, that batch rolls back
and the rows are retried one at a time. Only the genuinely bad rows fail; the rest still land.
Every failure comes with its line number, column and reason, and the whole report downloads as a
CSV you can hand back to whoever sent the file.

Large files run in the background. The dialog follows the job, but you can close it and pick the
job up later from **CSV Import & Export** in the main menu.

## Exporting

Open the **CSV** menu and choose **Export to CSV**.

**Which rows.** Add a filter per relation, say only the articles in *News* and *Sport*, plus a
date range on `createdAt`, `updatedAt` or `publishedAt`. Several values in one filter mean "any of
these". Several filters all have to match. If you tick rows in the List View first, the export
covers exactly those and the filters disappear.

**Which columns.** Tick what you want; tick nothing and you get everything. Your choice is
remembered per collection, and the same picker drives the template download, so you can hand
someone a narrow sheet to fill in rather than explaining which of forty columns to ignore.

Deselect the identifier column and the export still runs, with a warning. That file can no longer
update these entries, because an import would have nothing to match on and would create new ones
instead.

**Which version.** For a collection with draft & publish you pick one, and the `status` column in
the file records which you picked.

Rows are streamed and paged, so memory use does not grow with the collection. Fields your role
cannot read are left out, and `password` and `private` fields never appear at all.

### Filtering through the API

The export endpoint takes a deliberately narrow payload: a field name and a list of ids, never a
raw Strapi filter object. That way a caller cannot reach a column the plugin does not expose.

```jsonc
POST /strapi-import-export/content/api::article.article/export
{
  "status": "draft",
  "columns": ["documentId", "title", "category:name"],
  "relationFilters": [
    { "field": "category", "documentIds": ["k2m9x…", "p4r7y…"] }
  ],
  "dateFilters": [
    { "field": "createdAt", "from": "2026-01-01", "to": "2026-01-31" }
  ]
}
```

A bare `YYYY-MM-DD` in `to` covers the whole of that day. The dropdown values come from
`GET /content/:uid/relation-options?field=category&q=news`, which only lists entries from a
collection you are allowed to read.

## The CSV format

Full details in **[docs/csv-format.md](docs/csv-format.md)**. The short version:

| Structure | Header | Example cell |
|---|---|---|
| Scalar | `title` | `Hello world` |
| Single component | `seo.metaTitle` | `Hello world` |
| Repeatable component | `faq[0].question` | `Why?` |
| Single relation | `category:documentId` | `k2m9x…` |
| Relation label (read only) | `category:name` | `News` |
| Many relation | `tags:documentId` | `k2m9x…;p4r7y…` |
| Media | `cover:name` | `hero.webp` |
| Dynamic zone | `sections` | `[{"__component":"blocks.hero","heading":"Hi"}]` |
| Identifier | `documentId` | `abc123…` |
| Draft & publish | `status` | `draft` or `published` |
| i18n | `locale` | `en` |

Cells containing a space, colon, semicolon, pipe or tab are written inside quotes. That looks
fussy until you open a one-column export in LibreOffice, which guesses the separator when it finds
no commas and cheerfully splits `Girish Soman` across two cells. Quoting removes the guess.
Numbers stay unquoted so spreadsheets still treat them as numbers.

### Why relations get two columns

An export needs to be readable by a person and re-importable by a machine, so it writes both:

- **`category:documentId`** identifies exactly one entry. This is what an import matches on.
- **`category:name`** is read only, and exists so a human can see what the row points at. Imports
  ignore it.

The label field is guessed from the usual suspects (`name`, `title`, `label`, `displayName`,
`heading`). Change it, or turn the column off, under Settings → CSV Import & Export →
Configuration → Relations → Configure.

You can also match on a readable field instead, by setting **Match on** to something like `slug`.
Only fields that identify a single entry are offered: `documentId`, `uid` fields, and fields
marked unique. A non-unique match key would quietly attach rows to whichever entry the database
returned first, which is the kind of bug you find three months later.

## Configuration reference

Set these in the admin panel, or seed them from `config/plugins.ts` on first run.

| Setting | Default | Notes |
|---|---|---|
| `csvDelimiter` | `,` | Only affects files the plugin writes. Imports detect the delimiter. |
| `multiValueDelimiter` | `;` | Separates references inside one cell. Must differ from `csvDelimiter`. |
| `includeBom` | `true` | Excel on Windows needs this to read UTF-8 properly. |
| `escapeFormulas` | `true` | Neutralises CSV injection on export. Leave it on. |
| `mediaLookupKey` | `name` | One of `id`, `name`, `url`, `hash`. |
| `defaultImportMode` | `upsert` | |
| `maxFileSizeMb` | `50` | 1–512 |
| `maxRows` | `200000` | 1–1,000,000 |
| `maxColumns` | `200` | 1–2,000 |
| `maxCellLengthKb` | `100` | 1–1,024 |
| `batchSize` | `50` | Rows per transaction, 1–500 |
| `templateRepeatableSlots` | `3` | Slots a repeatable component gets in a template |
| `maxComponentDepth` | `3` | How deep component nesting is flattened |
| `jobRetentionDays` | `30` | How long import history is kept |

`seedCollections` in `config/plugins.ts` is applied **once**, only when the plugin store has never
been written. It cannot keep overriding an administrator's later changes on every boot. There is a
worked example in [`playground/config/plugins.js`](playground/config/plugins.js).

## Security

Bulk import touches a lot of data at once, so these are worth reading rather than skimming.

- **CSV injection.** Cells starting with `=`, `+`, `-`, `@`, tab or carriage return get an
  apostrophe in front of them on export. Plain numbers like `-5` are left alone so they still
  re-import as numbers.
- **Uploads** are checked on extension, size and actual content. A renamed `.xlsx`, `.xls`, `.pdf`
  or gzip file is caught by its magic bytes, a UTF-16 file is refused with advice to re-save, and a
  double extension like `payload.exe.csv` is rejected.
- **Prototype pollution.** Header names are matched against the schema and rows are built on
  null-prototype objects. A `__proto__` column is rejected outright rather than sanitised.
- **Sensitive fields.** `password` types and `private: true` attributes are never exported or
  imported, including through a component path. The admin, api-token, users-permissions and upload
  tables cannot be added to the allow-list at all.
- **Uploaded files** are staged under a random name in the OS temp directory, outside your
  project, and deleted when the run ends however it ends.
- **Logging** records counts, row numbers, column names and error codes. Cell values stay out of
  the application log. Validation messages do quote the offending value, truncated to 80
  characters, and those live in the import job record, which needs the same access as an import.
- **Concurrency.** One import at a time per collection.

## Known limitations

Written down so you find out now rather than halfway through a migration.

- **Collection types only.** Single types are not offered; a one-row CSV is not worth the round
  trip.
- **Media has to exist already** in the Media Library. Importing from a URL would let anyone who
  can upload a CSV choose which URLs your server fetches, which is a server-side request forgery
  risk.
- **Dynamic zones travel as JSON** in one cell. Powerful, but not something a content editor will
  hand-write.
- **Polymorphic relations are skipped.** They have no single target, so they cannot be a column.
  The configuration page lists which fields were skipped and why.
- **One version per file.** A CSV holds either the draft or the published version of each entry.
- **`status=draft` never unpublishes.** It writes the draft and leaves any published version
  alone, so an import cannot accidentally take a live site down.
- **Many-relations are replaced, not appended.** A `tags:slug` cell sets the complete list.
- **Repeatable components get a fixed number of template slots**, three by default. More entries
  need more columns, which you can add by hand following the `faq[3].question` pattern.
- **Export paging is offset based** with a stable sort. An entry created during a very large
  export can shift a row.
- **An interrupted import is not resumed.** If the process running it stops, the job is marked
  interrupted. Re-run the file; `upsert` makes that safe.
- **Excel edits your data on save.** It strips leading zeros from values like `00123` and turns
  long digit strings into scientific notation. Format those columns as Text first.
- **`biginteger` values travel as text** to keep precision beyond what a double can hold.
- The List View button uses `unstable_useContentManagerContext` from `@strapi/strapi/admin`. It is
  the documented hook for plugin development, but that `unstable_` prefix means it can change
  between Strapi minor versions. If it does, the settings page and the plugin page carry on
  working.

## Contributing

```bash
npm install
npm run build               # admin + server bundles and type declarations
npm test                    # 439 unit tests, no database needed
npm run test:integration    # boots a real Strapi app on SQLite, 45 tests
npm run check               # typecheck admin, server and tests, then unit tests and build
npm run check:all           # everything, including the integration suite
```

`playground/` is a complete Strapi 5 app whose `Article` type carries one of every attribute kind
the plugin supports, which is what the integration tests run against. See
[`playground/README.md`](playground/README.md).

### Installing a local build into your own project

One command, run in the plugin repository:

```bash
npm run pack:local -- --install "/path/to/your/strapi-project"
```

It builds the plugin, packs a uniquely named tarball, installs it with whichever package manager
the target project uses, clears the admin build caches, rebuilds the admin panel, and then checks
that every installed file matches the build it just made. Set `IE_INSTALL_TARGET` once and you can
drop the path:

```bash
export IE_INSTALL_TARGET=/path/to/your/strapi-project
npm run pack:local
```

Add `--skip-build` to skip the admin rebuild when your change is server-side only. Restart Strapi
afterwards and **hard-refresh the browser** (Ctrl+Shift+R), because the cached admin bundle still
holds the previous build.

Without `--install` the script only packs and prints the commands to run by hand. You then need to
delete `node_modules/.strapi/vite`, run the project's own build, and restart.

<details>
<summary>Why <code>pack:local</code> rather than plain <code>npm pack</code></summary>

Both npm and yarn cache a `file:` tarball under its package name and version. Reinstalling a
rebuilt tarball with the *same filename* therefore does one of three unhelpful things:

- reports success and installs the previously cached copy, so your change appears to do nothing;
- fails with `error Integrity check failed` once the lockfile hash no longer matches;
- with yarn, either of those depending on the state of its cache.

`pack:local` writes a timestamped filename every time, which has never been cached, so the install
always reflects the build. Verified against yarn 1.22 and npm 10.

A cache hit is silent, so with `--install` the script also hashes every installed file and compares
it against the build. A mismatch fails the command instead of leaving you to debug a UI that is
showing you stale code.

</details>

<details>
<summary>Why not <code>npm link</code> or <code>yarn link</code></summary>

Linking creates a symlink, and a plugin loaded from outside your project's `node_modules` resolves
its **own** copy of `@strapi/utils`. Its error classes then fail Strapi's `instanceof` checks, so
every validation error surfaces as a **500 with no message** instead of a 400 explaining what is
wrong. The code is fine; the module identity is not.

A folder dependency (`file:../plugin-folder`) has the same problem and adds a new one: yarn copies
the whole directory, ignoring the `files` field, which in this repo means 1.5 GB and 170,000 files
landing in your `node_modules`, including a second copy of React.

A tarball install has exactly one copy of everything and behaves like a published install.

</details>

<details>
<summary>If the database driver complains about a Node version</summary>

```
The module 'better_sqlite3.node' was compiled against a different Node.js version
using NODE_MODULE_VERSION 115. This version of Node.js requires NODE_MODULE_VERSION 127.
```

Your Node version changed after the native driver was installed. Rebuild it in whichever project
reports the error:

```bash
npm rebuild better-sqlite3
```

The plugin repository and the playground each have their own copy, so you may need to do both.

</details>

## Licence

MIT
