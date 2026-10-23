# strapi-plugin-import-export

Bulk CSV import and export for Strapi 5 collections, driven by your own schema.

The plugin reads each collection's schema, generates a matching CSV template, validates an
uploaded file row by row, and reports exactly what happened. Which collections are exposed, and
which roles may import or export them, is decided by an administrator in the admin panel — nothing
is available until it is switched on.

## Supported versions

| | |
|---|---|
| Strapi | **5.x only** (`@strapi/strapi` `^5.0.0`) |
| Node | 18, 20, 22 |
| Databases | SQLite, PostgreSQL, MySQL / MariaDB |

Strapi v4 is **not** supported. It [reached end of life on 30 April 2026](https://docs.strapi.io/cms/migration/v4-to-v5/introduction-and-faq),
and its admin panel uses a different design system and a different Content Manager extension API,
so supporting it would mean a second admin bundle rather than a compatibility shim.

## Install

```bash
npm install strapi-plugin-import-export
npm run build        # rebuild the admin panel so the plugin's UI is included
npm run develop
```

The `npm run build` step is not optional. The plugin ships React components that have to be
compiled into your admin bundle, so skipping it leaves the CSV menu missing with no error.

### Installing a local build

One command, run in the plugin repository:

```bash
npm run pack:local -- --install "/path/to/your/strapi-project"
```

It builds the plugin, packs a uniquely named tarball, installs it with whichever package manager
the target project uses, clears the admin build caches, rebuilds the admin panel, and then checks
that every file it installed matches the build it just made. Set `IE_INSTALL_TARGET` once and the
path can be dropped:

```bash
export IE_INSTALL_TARGET=/path/to/your/strapi-project
npm run pack:local
```

Add `--skip-build` to skip the admin rebuild when the change is server-side only.

Restart Strapi afterwards, then **hard-refresh the browser** (Ctrl+Shift+R) — the cached admin
bundle still holds the previous build.

Without `--install` the script only packs, and prints the commands to run by hand:

```bash
# in your Strapi project — npm
npm install "/tmp/strapi-plugin-import-export-packs/strapi-plugin-import-export-0.1.0-20261023105159.tgz"

# in your Strapi project — yarn
yarn add "file:/tmp/strapi-plugin-import-export-packs/strapi-plugin-import-export-0.1.0-20261023105159.tgz"
```

Then delete `node_modules/.strapi/vite`, run the project's own build, and restart.

#### Why `pack:local` rather than plain `npm pack`

Both npm and yarn cache a `file:` tarball under its package name and version. Reinstalling a
rebuilt tarball with the *same filename* therefore does one of three unhelpful things:

- reports success and installs the previously cached copy, so your change appears to do nothing;
- fails with `error Integrity check failed` once the lockfile hash no longer matches;
- with yarn, either of those depending on the state of its cache.

`npm run pack:local` writes a timestamped filename each time, which has never been cached, so the
install always reflects the build. Verified against yarn 1.22 and npm 10.

A cache hit is silent — the install reports success having unpacked an older copy — so with
`--install` the script hashes every file it installed and compares it against the build. A
mismatch fails the command instead of leaving you to debug a UI that is showing you stale code.

#### If the database driver complains about a Node version

```
The module 'better_sqlite3.node' was compiled against a different Node.js version
using NODE_MODULE_VERSION 115. This version of Node.js requires NODE_MODULE_VERSION 127.
```

Your Node version changed since the native driver was installed. Rebuild it in whichever project
reports the error:

```bash
npm rebuild better-sqlite3
```

This affects the plugin repository and the playground independently, because each has its own
copy.

#### Why not `npm link` or `yarn link`

Linking creates a symlink, and a plugin loaded from outside your project's `node_modules`
resolves its **own** copy of `@strapi/utils`. Its error classes then fail Strapi's `instanceof`
checks, so every validation error surfaces as a **500 with no message** instead of a 400
explaining what is wrong. The code is fine; the module identity is not. A tarball install has one
copy of everything and behaves exactly like a published install.

The plugin is enabled automatically. To configure it in code instead, add a block to
`config/plugins.ts`:

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

## Set it up

Three things have to line up before a button appears. This is deliberate: a bulk import endpoint
that is open by default is a data-loss incident waiting to happen.

1. **Grant the plugin permissions.** Go to **Settings → Administration Panel → Roles**, pick a
   role, and enable the actions under **CSV Import & Export**.
2. **Enable the collections.** Go to **Settings → CSV Import & Export → Configuration** and switch
   on the collections you want, with import and export chosen per collection.
3. **Grant the collections to roles.** On the same page, under **Role access**, tick which roles may
   import or export each enabled collection. Super admins are granted automatically.

Then open a collection in the Content Manager. A **CSV** menu appears above the table.

### The permissions

| Permission | What it allows |
|---|---|
| `config.read` | View the configuration page |
| `config.update` | Change allowed collections and role grants |
| `template.download` | Download CSV templates and the column guide |
| `import.run` | Run validations and imports |
| `export.run` | Export a collection to CSV |
| `job.read` | View import history and validation reports |

A user also needs the matching **Content Manager** rights on the collection itself. Someone who
cannot read Article in the Content Manager cannot export it here either, whatever the plugin
settings say, so the plugin can never be used to get around your existing permissions.

## Importing

1. Open the **CSV** menu and choose **Import from CSV**.
2. Download the template, fill it in, and save as **CSV UTF-8**.
3. Upload it and press **Check the file**. Nothing is written yet.
4. Read the report. If it is clean, press **Import**.

The Import button stays disabled until a validation run comes back without errors, so a file with
a broken header cannot be applied by clicking through.

### What happens to rows that already exist

Rows are matched on the identifier column configured for the collection (`documentId` by default).

| Mode | Row exists | Row does not exist |
|---|---|---|
| `upsert` (default) | updated | created |
| `create-only` | **fails** with `duplicate` | created |
| `update-only` | updated | **fails** with `not_found` |
| `skip-duplicates` | skipped silently | created |

### Empty cells

This is the rule that surprises people, so it is worth stating plainly:

- **A column that is present with an empty cell clears that field.**
- **A column that is absent from the file is never touched.**

So a two-column file of `documentId,title` updates titles and leaves everything else alone. The
file is the source of truth for the columns it contains, and only for those.

### Failure handling

Validation happens before anything is written, so a row with a bad value never reaches the
database and never affects its neighbours.

Writes are committed in batches inside a transaction. If the database rejects a batch, the batch
rolls back and the rows are retried one at a time, so only the genuinely bad rows fail and the
rest still land. Every failure is reported with its line number, column and reason, and can be
downloaded as a CSV.

Large files run in the background. The dialog follows the job; you can close it and come back
through **CSV Import & Export** in the main menu.

## Exporting

Open the **CSV** menu and choose **Export to CSV**.

**Which rows.** Add one filter per relation — for example only the articles in the *News* and
*Sport* categories — and a date range on `createdAt`, `updatedAt` or `publishedAt`. Several
values in one filter mean "any of these"; several filters all have to match. Selecting rows in
the List View first exports exactly those instead, and hides the filters.

**Which columns.** Tick the columns you want. Nothing ticked means every column. The choice is
remembered per collection, and the same picker applies to the template download so you can hand
someone a narrow sheet to fill in.

If you deselect the identifier column the export still works, with a warning: that file can no
longer be used to update these entries, because an import would have nothing to match on and
would create new ones.

**Which version.** For a collection with draft & publish you pick one; the `status` column in the
file records which it was.

Rows are streamed and paged, so memory use does not grow with the size of the collection. Fields
your role cannot read are left out of the file, and `password` and `private` fields are never
included.

### Filtering through the API

The export endpoint takes a deliberately narrow payload — a field name and a list of ids, never a
raw Strapi filter object, so a caller cannot reach a column the plugin does not expose:

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

A bare `YYYY-MM-DD` in `to` covers the whole of that day. Values for the dropdowns come from
`GET /content/:uid/relation-options?field=category&q=news`, which only lists entries from a
collection you are allowed to read.

## CSV format

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

### Relations get two columns

An export of a relation is readable and re-importable at the same time, because it writes both:

- **`category:documentId`** — the value that identifies exactly one entry. This is what an import
  matches on.
- **`category:name`** — read only, there so a person can tell what the row points at. An import
  ignores it.

The label field is guessed from the usual names (`name`, `title`, `label`, `displayName`,
`heading`). Change it, or switch the column off, under **Settings → CSV Import & Export →
Configuration → Relations → Configure**.

You can also match on a readable field instead, by setting **Match on** to something like `slug`.
Only fields that identify a single entry are offered there — `documentId`, `uid` fields and fields
marked unique — because a non-unique match key would make an import attach rows to whichever
entry the database happened to return first.

## Configuration reference

Set in the admin panel, or seeded from `config/plugins.ts` on first run.

| Setting | Default | Notes |
|---|---|---|
| `csvDelimiter` | `,` | Only affects files the plugin writes. Imports detect the delimiter. |
| `multiValueDelimiter` | `;` | Separates references inside one cell. Must differ from `csvDelimiter`. |
| `includeBom` | `true` | Needed for Excel on Windows to read UTF-8 correctly. |
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
been written, so it cannot keep overriding an administrator's later changes on every boot. See
[`playground/config/plugins.js`](playground/config/plugins.js) for a worked example.

## Security

- **CSV injection**: cells beginning with `=`, `+`, `-`, `@`, tab or carriage return are prefixed
  with an apostrophe on export. Plain numbers such as `-5` are left alone so they still re-import
  as numbers.
- **Uploads** are checked on extension, size and content. A renamed `.xlsx`, `.xls`, `.pdf` or
  gzip file is refused by its magic bytes, a UTF-16 file is refused with advice to re-save, and a
  double extension such as `payload.exe.csv` is rejected.
- **Prototype pollution**: header names are matched against the schema and rows are built on
  null-prototype objects. A `__proto__` column is rejected rather than sanitised.
- **Sensitive fields**: `password`-type and `private: true` attributes are never exported or
  imported, including through a component path. The admin, api-token, users-permissions and upload
  tables cannot be added to the allow-list at all.
- **Uploaded files** are staged under a random name in the OS temp directory, outside the project,
  and deleted when the run ends however it ends.
- **Logging** records counts, row numbers, column names and error codes. Cell values stay out of
  the application log. Validation messages do quote the offending value, truncated to 80
  characters, and live in the import job record, which needs the same access as an import.
- **Concurrency**: one import at a time per collection.

## Known limitations

- **Collection types only.** Single types are not offered; a one-row CSV is not worth the
  round trip.
- **Media must already exist** in the Media Library. Importing from a URL would let anyone who
  can upload a CSV choose which URLs your server fetches, which is a server-side request forgery
  risk, so it is not supported.
- **Dynamic zones travel as JSON** in a single cell. Powerful, but not something a content editor
  will hand-write.
- **Polymorphic relations are skipped.** They have no single target, so they cannot be a column.
  The configuration page lists which fields were skipped and why.
- **One version per file.** A CSV holds either the draft or the published version of each entry.
- **`status=draft` never unpublishes.** It writes the draft and leaves any published version
  alone, so an import cannot accidentally take a site down.
- **Many-relations are replaced, not appended.** A `tags:slug` cell sets the complete list.
- **Repeatable components get a fixed number of template slots** (3 by default). More entries
  need more columns, which you can add by hand following the `faq[3].question` pattern.
- **Export paging is offset based** with a stable sort. An entry created while a very large export
  is running may shift a row.
- **An interrupted import is not resumed.** If the process running it stops, the job is marked
  interrupted. Re-run the file; `upsert` makes that safe.
- **Excel edits data on save.** It strips leading zeros from values like `00123` and turns long
  digit strings into scientific notation. Format those columns as Text before saving.
- **`biginteger` values travel as text** to keep precision beyond what a double can hold.
- The List View button uses `unstable_useContentManagerContext` from `@strapi/strapi/admin`. It is
  the documented hook for plugin development, but the `unstable_` prefix means it may change
  between Strapi minors. If it does, the settings page and the plugin page keep working.

## Development

```bash
npm install
npm run build          # build admin + server bundles and type declarations
npm test               # 316 unit tests, no database needed
npm run test:integration   # boots a real Strapi app on SQLite
npm run check          # typecheck admin, server and tests, then unit tests and build
npm run check:all      # everything, including the integration suite
```

`playground/` is a complete Strapi 5 app whose `Article` type carries one of every attribute kind
the plugin supports. See [`playground/README.md`](playground/README.md).

## Licence

MIT
