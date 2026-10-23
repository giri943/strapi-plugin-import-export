# Playground

A small Strapi 5 app used to try the plugin by hand and to run the integration tests against a
real database.

The `Article` content type deliberately contains one of every attribute kind the plugin supports:
scalars of each type, an enumeration, JSON, a private field, a single component, a repeatable
component, a dynamic zone, single and multiple media, a `manyToOne` relation and a `manyToMany`
relation. Draft & publish is on.

## Run it

```bash
# once, from the repository root
npm install
npm run build

# then
cd playground
cp .env.example .env
npm install
npm run develop
```

Open `http://localhost:1337/admin`, create the first administrator, then look under
**Settings → CSV Import & Export → Configuration**. Article, Author and Tag are already enabled
by the seed in `config/plugins.js`.

In the Content Manager, open **Article** and use the **CSV** menu above the table.

## How the plugin is loaded

Two modes, chosen by an environment variable.

**Default — linked from the working tree.** `config/plugins.js` points `resolve` at the repository
root, so the playground runs the build in this working tree with no install step. Run
`npm run build` in the root after changing plugin source. This is what the integration tests use.

**With `IE_USE_INSTALLED_PLUGIN=true` — the installed copy.** Strapi discovers the plugin from
`node_modules` like any published install:

```bash
# from the repository root
npm run build && npm pack

cd playground
npm install ../strapi-plugin-import-export-0.1.0.tgz
IE_USE_INSTALLED_PLUGIN=true npm run develop
```

### Why both modes exist

A plugin loaded through `resolve` sits outside the app's `node_modules`, so `require('@strapi/utils')`
inside it resolves to the *plugin's* copy rather than the app's. The error classes it throws then
fail Strapi's `instanceof` checks in `createAuthorizeMiddleware` and the error middleware, and
every validation error comes back as a **500 with no message** instead of a 400 that says what is
wrong.

The linked mode is still the right default for iterating on code. Use the installed mode whenever
you are checking status codes, error messages or anything else about the HTTP surface.


## Database

SQLite, written to `playground/.tmp/data.db`. Delete that file to start over.
