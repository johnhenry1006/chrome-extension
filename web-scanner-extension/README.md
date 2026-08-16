# Web Data Scanner v5.2

Chrome Manifest V3 extension for scanning web pages and saving results into SQLite WASM + OPFS.

## Build

```bash
npm install
npm run build
```

The build performs three steps:

1. Vite builds the extension.
2. `copy-sqlite-wasm.mjs` copies `sqlite3.wasm` into `dist/`.
3. `verify-build.mjs` validates the final `dist/` structure and Manifest V3 requirements.

Load the generated `dist/` folder from `chrome://extensions` with Developer mode enabled.

## Important output paths

Vite emits HTML entry points at the root of `dist/`:

```text
dist/
├── popup.html
├── manager.html
├── offscreen.html
├── sqlite3.wasm
├── src/background/service-worker.js
├── src/content/content.js
└── src/db-worker/sqlite-worker.js
```

The extension uses an Offscreen Document to create the SQLite dedicated Worker because MV3 Service Workers cannot construct a `Worker` directly.

## Fields JSON behavior

The popup preserves custom Fields JSON when the Mode changes.

- If Fields JSON is still the generated sample for the current mode, changing Mode automatically applies the sample for the new mode.
- If Fields JSON has been edited, changing Mode keeps the user's custom JSON unchanged.
- When custom JSON is preserved, `Reset Fields Sample` becomes available.
- Clicking `Reset Fields Sample` explicitly replaces the JSON with the sample for the selected mode.
- JSON comparison is normalized, so changing only whitespace/formatting does not count as a customization.

## Offline Reader.

Scan
 │
 ├── data
 │    ├── text
 │    ├── textWithBreaks
 │    └── html
 │
 └── config
      ├── mode
      ├── selector
      └── fields
             │
             ▼
        SQLite / OPFS
             │
             ▼
       Offline Reader
             │
      ┌──────┴───────┐
      ▼              ▼
    Text            HTML
      │              │
      ▼              ▼
   <pre>       Sanitized HTML
                    │
                    ▼
               Sandbox iframe

## Offline navigation

Offline View now supports Previous/Next navigation between saved records that belong to the same domain and the same scan configuration type. A `scan_type_key` is stored with each scan result using a stable JSON representation of the scanner configuration. Existing records are migrated from their saved config when possible; records without valid config remain in the legacy type.

## Fixed in v5.2 Fixed 8

Offline Previous/Next navigation now persists `scan_type_key` correctly when saving a scan. The migration also backfills classification for existing records from their saved `config_json`. Navigation matches records by domain + normalized scanner configuration type.

## v0.5.9

- Added an Offline View navigation filter: `All saved pages` or `Same domain + same scan type`.
- The selected navigation filter is preserved when moving to Previous/Next.
- Added Manager Page sorting by saved date, title, and domain.
- Sorting is applied before grouping by domain, so the group order also follows the selected sort.
