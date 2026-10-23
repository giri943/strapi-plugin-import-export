# Security and limitations

Bulk import touches a lot of data at once, so this page is worth reading rather than skimming.

## What is hardened

**CSV injection.** Cells starting with `=`, `+`, `-`, `@`, tab or carriage return get an apostrophe
in front of them on export. Plain numbers like `-5` are left alone so they still re-import as
numbers.

**Uploads** are checked on extension, size and actual content. A renamed `.xlsx`, `.xls`, `.pdf` or
gzip file is caught by its magic bytes, a UTF-16 file is refused with advice to re-save, and a
double extension like `payload.exe.csv` is rejected.

**Prototype pollution.** Header names are matched against the schema and rows are built on
null-prototype objects. A `__proto__` column is rejected outright rather than sanitised.

**Sensitive fields.** `password` types and `private: true` attributes are never exported or
imported, including through a component path. The admin, api-token, users-permissions and upload
tables cannot be added to the allow-list at all.

**Uploaded files** are staged under a random name in the OS temp directory, outside your project,
and deleted when the run ends however it ends.

**Logging** records counts, row numbers, column names and error codes. Cell values stay out of the
application log. Validation messages do quote the offending value, truncated to 80 characters, and
those live in the import job record, which needs the same access as an import.

**Concurrency.** One import at a time per collection.

**Export filters** take a field name and a list of ids, never a raw Strapi filter object, so a
caller cannot reach a column the plugin does not expose. Column selection is intersected with the
generated columns, which makes injecting a private field structurally impossible rather than just
blocked.

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
- **`status=draft` never unpublishes.** It writes the draft and leaves any published version alone,
  so an import cannot accidentally take a live site down.
- **Many-relations are replaced, not appended.** A `tags:slug` cell sets the complete list.
- **Repeatable components get a fixed number of template slots**, three by default. More entries
  need more columns, added by hand following the `faq[3].question` pattern.
- **Export paging is offset based** with a stable sort. An entry created during a very large export
  can shift a row.
- **An interrupted import is not resumed.** If the process running it stops, the job is marked
  interrupted. Re-run the file; `upsert` makes that safe.
- **Excel edits your data on save.** It strips leading zeros from values like `00123` and turns long
  digit strings into scientific notation. Format those columns as Text first.
- **`biginteger` values travel as text** to keep precision beyond what a double can hold.
- The List View button uses `unstable_useContentManagerContext` from `@strapi/strapi/admin`. It is
  the documented hook for plugin development, but that `unstable_` prefix means it can change
  between Strapi minor versions. If it does, the settings page and the plugin page carry on
  working.

## Reporting a vulnerability

Open a private security advisory on the repository rather than a public issue.
