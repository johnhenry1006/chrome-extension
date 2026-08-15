import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const dist = path.join(root, "dist");
const packageDir = path.join(root, "node_modules/@sqlite.org/sqlite-wasm");
const sqliteDir = path.join(packageDir, "sqlite-wasm");

try {
    await fs.access(sqliteDir);
} catch {
    console.log("SQLite WASM package not found. Run `npm install` first.");
    process.exit(0);
}

const target = path.join(dist, "sqlite-wasm");

await fs.rm(target, { recursive: true, force: true });

await fs.cp(sqliteDir, target, { recursive: true });

console.log("SQLite WASM assets copied to dist/sqlite-wasm/.");
