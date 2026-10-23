# Configuration

## Permissions

Six RBAC actions, granted per role under **Settings → Administration Panel → Roles → CSV Import &
Export**.

| Permission | What it allows |
|---|---|
| `read-config` | View the configuration page |
| `update-config` | Change allowed collections and role grants |
| `download-template` | Download CSV templates and the column guide |
| `run-import` | Run validations and imports |
| `run-export` | Export a collection to CSV |
| `read-history` | View import history and validation reports |

These are only the first gate. Every request also re-checks the caller's own **Content Manager**
rights on the collection, so a role that cannot read Article in the Content Manager cannot export
it here no matter what the plugin settings say.

Super admins bypass the per-collection role grant so they cannot lock themselves out, but they
still need the collection to be enabled and still go through their own Content Manager rights.

## Settings

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

## Seeding from code

The plugin is enabled as soon as it is installed. You only need a config block to seed settings:

```ts
export default () => ({
  'strapi-import-export': {
    enabled: true,
    config: {
      csvDelimiter: ',',
      multiValueDelimiter: ';',
      maxFileSizeMb: 50,
      maxRows: 200_000,

      seedCollections: {
        'api::article.article': {
          enabled: true,
          allowImport: true,
          allowExport: true,
          identifierField: 'documentId',
          relationLookupKeys: {
            'api::author.author': 'email',
            'api::tag.tag': 'slug',
          },
        },
      },
    },
  },
});
```

`seedCollections` is applied **once**, only when the plugin store has never been written. It
cannot keep overriding an administrator's later changes on every boot.

## Relation keys

Each relation gets a **match key** and a **label field**, both configurable under **Settings → CSV
Import & Export → Configuration → Relations → Configure**.

The **label field** is guessed from the usual names (`name`, `title`, `label`, `displayName`,
`heading`) and produces the read-only `category:name` column. Switch it off if you do not want it.

The **match key** is what an import looks the entry up by. Only fields that identify a single entry
are offered: `documentId`, `uid` fields, and fields marked unique. A non-unique match key would
quietly attach rows to whichever entry the database returned first, which is the kind of bug you
find three months later.
