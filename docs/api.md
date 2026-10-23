# Calling the endpoints directly

Every route lives under `/strapi-import-export` and needs an authenticated admin session with the
matching permission. These are admin routes, not Content API routes.

## Export

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

Returns `text/csv`.

The payload is deliberately narrow: a field name and a list of ids, never a raw Strapi filter
object. A caller therefore cannot reach a column the plugin does not expose. A raw `filters` key is
ignored rather than honoured, and an unknown filter field returns `400` with a message naming it.

`columns` is intersected with the columns the plugin generated for the collection, so an unknown or
private header cannot be smuggled in. Omit it to export everything.

A bare `YYYY-MM-DD` in `to` covers the whole of that day. Omit `from` or `to` for an open-ended
range.

## Filter options

```
GET /strapi-import-export/content/api::article.article/relation-options?field=category&q=news
```

Lists entries of the related collection for a filter dropdown, with their readable labels. The
caller's own query sanitiser is applied, so a role limited to a subset of the target collection
only sees that subset.

## Columns and templates

```
GET /strapi-import-export/content/:uid/columns
GET /strapi-import-export/content/:uid/template
GET /strapi-import-export/content/:uid/template?guide=1
GET /strapi-import-export/content/:uid/template?columns=documentId,title
```

## Import

Multipart, with the CSV as the `file` field:

```
POST /strapi-import-export/content/:uid/import
POST /strapi-import-export/content/:uid/import/dry-run
```

Other fields: `mode` (`upsert`, `create-only`, `update-only`, `skip-duplicates`) and `locale`.

Both return `202` with a `jobId` and a `pollUrl`, because a large file outlives any request
timeout. Poll the job for progress and the final counters.

## Jobs

```
GET /strapi-import-export/jobs
GET /strapi-import-export/jobs/:jobId
GET /strapi-import-export/jobs/:jobId/errors
```

The last one returns the row errors as a CSV you can hand back to whoever sent the file.

## Settings

```
GET /strapi-import-export/settings
PUT /strapi-import-export/settings
GET /strapi-import-export/settings/collections/:uid
```
