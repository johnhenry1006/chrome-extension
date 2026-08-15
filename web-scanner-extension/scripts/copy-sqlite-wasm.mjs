import fs from "node:fs";
import path from "node:path";

const packageRoot = path.resolve("node_modules/@sqlite.org/sqlite-wasm");
const dist = path.resolve("dist");

if (!fs.existsSync(packageRoot)) {
    throw new Error(
        "SQLite WASM package is not installed. Run npm install first.",
    );
}

function findWasm(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
        const fullPath = path.join(dir, entry.name);

        if (entry.isDirectory()) {
            const found = findWasm(fullPath);
            if (found) return found;
            continue;
        }

        if (entry.name === "sqlite3.wasm") {
            return fullPath;
        }
    }

    return null;
}

const wasmPath = findWasm(packageRoot);
if (!wasmPath) {
    throw new Error(
        "Could not find sqlite3.wasm inside @sqlite.org/sqlite-wasm.",
    );
}

fs.copyFileSync(wasmPath, path.join(dist, "sqlite3.wasm"));
console.log(`Copied SQLite WASM from ${wasmPath}`);
