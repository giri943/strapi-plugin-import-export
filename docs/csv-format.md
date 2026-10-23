# CSV format

How a Strapi schema becomes CSV columns, and how cells are read back.

Download the **column guide** next to the template to get this information for one specific
collection, generated from its own schema.

## Header grammar

```
header    := path ( ":" lookupKey )?
path      := segment ( "." segment )*
segment   := name ( "[" index "]" )?
name      := letter or underscore, then letters, digits, underscores
index     := 0 – 199
lookupKey := name
```

A header may nest at most 5 levels and be at most 200 characters. `__proto__`, `constructor` and
`prototype` are rejected anywhere in a header.

Headers are matched **exactly**, including case. A header that does not match is reported, and if
it differs only by case, spaces, hyphens or underscores the report names the column you probably
meant.

## Column kinds

### Built-in columns

| Column | Present when | On import |
|---|---|---|
| `documentId` | always | blank creates a new entry, filled updates the matching one |
| `locale` | the collection has i18n enabled | which locale the row belongs to |
| `status` | the collection has draft & publish | `draft` or `published` |
| `createdAt`, `updatedAt`, `publishedAt` | always / with draft & publish | **ignored**, present in exports only |

`status` and `locale` are reserved attribute names in Strapi, so these columns can never collide
with a field of your own.

### Scalars

One column, named after the attribute.

| Type | Accepted | Notes |
|---|---|---|
| `string`, `text`, `richtext` | any text | trimmed; `minLength` / `maxLength` enforced |
| `email` | `ada@example.com` | validated |
| `uid` | `my-post_2` | letters, digits, `-`, `_`, `~` |
| `enumeration` | one of the declared values | case-sensitive; a near miss is named in the error |
| `boolean` | `true`, `false`, `1`, `0`, `yes`, `no`, `y`, `n`, `on`, `off` | case-insensitive |
| `integer` | `42`, `-42` | rejected beyond safe integer precision |
| `biginteger` | `9007199254740993` | kept as text to preserve precision |
| `decimal`, `float` | `4.25`, `-1.5e3` | `NaN` and `Infinity` rejected |
| `date` | `2026-01-31` or `2026/01/31` | `31/01/2026` is rejected as ambiguous |
| `datetime` | ISO 8601, or a bare date | normalised to UTC ISO |
| `time` | `09:30`, `09:30:15` | |
| `timestamp` | Unix seconds | |
| `json`, `blocks` | JSON in one cell | |
| `password` | — | never imported or exported |

Dates are deliberately strict. `01/02/2026` means February in one country and January in another,
and silently importing the wrong one is worse than refusing the row.

### Components

A single component is flattened with a dot:

```
seo.metaTitle,seo.metaDescription,seo.shareImage:name
```

A repeatable component gets one set of columns per slot:

```
faq[0].question,faq[0].answer,faq[1].question,faq[1].answer
```

Templates offer three slots by default (`templateRepeatableSlots`). To import more entries, add
the columns by hand following the same pattern.

**A slot whose every cell is empty is dropped**, including its required fields. So an unused slot
costs nothing, and gaps close up: filling only `faq[1]` produces a single entry, not an empty one
followed by a real one.

### Relations

Each relation produces **two** columns: one that identifies the entry and one that reads well.

```
category:documentId    the match key — an import resolves this
category:name          the label — read only, ignored on import
```

The **match key** is configured per target collection on the configuration page. Only
`documentId`, `uid` fields and fields marked `unique` can be chosen, because anything else could
match several entries and the import would silently pick one.

The **label** only has to be readable, so any plain text, number or enumeration field qualifies
and uniqueness is irrelevant. It is guessed from `name`, `title`, `label`, `displayName`,
`heading` in that order, and can be changed or switched off per target.

Two categories both called "Shared" therefore export as two rows with the same
`category:name` but different `category:documentId`, and re-import to the right one.

If you would rather have a single readable column, set the match key to a unique field such as
`slug`. The label column then disappears, because it would duplicate the match column:

```
category:slug          both readable and importable
```

Several references go in one cell, separated by the list delimiter (`;` by default):

```
news;sport;culture
```

If a value itself contains the delimiter, escape it with a backslash. Exports do this for you:

```
a\;b;c     →   two references: "a;b" and "c"
```

**A missing target fails the row.** The plugin never creates the related entry for you: a typo in
an email would otherwise create a ghost author that nobody notices. Create the related entries
first, or import them from their own CSV.

**A many-relation cell replaces the whole list.** An empty cell clears it.

Polymorphic relations (`morphToOne`, `morphToMany` and friends) have no single target and are not
exported or imported.

### Media

Like relations, but matched against the Media Library:

```
cover:name          hero.webp
gallery:name        hero.webp;diagram.png
```

The match field is `name` by default, and can be `id`, `url` or `hash`. The file must already be
in the Media Library. If two files share the value, the row fails rather than guessing.

### Dynamic zones

One column holding a JSON array. Every entry needs a `__component` key naming an allowed
component:

```csv
title,sections
"My page","[{""__component"":""blocks.hero"",""heading"":""Hi""},{""__component"":""blocks.cta"",""label"":""Go"",""url"":""https://example.com""}]"
```

Remember that a `"` inside a CSV cell is written as `""`. An entry naming a component the zone does
not allow is rejected and the error lists the allowed ones.

## Encoding and delimiters

**Exports** are UTF-8 with a byte order mark, comma separated, CRLF line endings. The BOM is what
makes Excel on Windows read UTF-8 instead of mangling accented characters.

**Imports** detect the delimiter from the header line among comma, semicolon, tab and pipe, and
strip a BOM if present. A file saved by Excel in a locale that uses semicolons imports without you
changing anything.

## Empty cells

| Situation | Result |
|---|---|
| Column present, cell empty | the field is set to empty |
| Column absent from the file | the field is not touched |
| Column present, cell empty, field required | the row fails |
| Every cell of a component slot empty | the slot is dropped |

## Limits

| Limit | Default |
|---|---|
| File size | 50 MB |
| Rows | 200,000 |
| Columns | 200 |
| Cell length | 100 KB |
| Header length | 200 characters |
| Header nesting | 5 levels |
| Repeatable index | 0–199 |
| Stored row errors per job | 1,000 |

All of these except the last three are configurable.

## A worked example

The `Article` type in `playground/` resolves to 32 columns. The template omits the three read-only
timestamps (`createdAt`, `updatedAt`, `publishedAt`), leaving 29:

```
documentId,status,title,slug,body,summary,views,rating,bigCounter,featured,state,
publishDate,readAt,startsAt,metadata,seo.metaTitle,seo.metaDescription,seo.shareImage:name,
faq[0].question,faq[0].answer,faq[1].question,faq[1].answer,faq[2].question,faq[2].answer,
sections,author:email,tags:slug,cover:name,gallery:name
```

Three observations about that list:

- `internalNote` is absent because the schema marks it `private`.
- There is no `locale` column, because the playground's `Article` does not enable i18n.
- `faq` takes six columns: three slots of two fields, from the default `templateRepeatableSlots`.
