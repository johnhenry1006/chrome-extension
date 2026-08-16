import fs from "node:fs";
import path from "node:path";

const root = path.resolve(".");
const dist = path.join(root, "dist");

const files = [
    "src/popup/popup.html",
    "src/popup/popup.js",
    "src/popup/popup.css",
    "src/manager/manager.html",
    "src/manager/manager.js",
    "src/manager/manager.css",
    "src/offscreen/offscreen.html",
    "src/offscreen/offscreen.js",
    "src/offscreen/sqlite-client.js",
    "src/offline/offline.html",
    "src/offline/offline.js",
    "src/offline/offline.css",
];

for (const relative of files) {
    const source = path.join(root, relative);
    const target = path.join(dist, relative);

    if (!fs.existsSync(source)) {
        throw new Error(`Missing source runtime file: ${relative}`);
    }

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(source, target);
}

console.log(`Copied ${files.length} runtime files.`);
