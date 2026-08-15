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
