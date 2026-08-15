import fs from "node:fs";
import path from "node:path";

const dist = path.resolve("dist");

function assertFile(relative) {
    const file = path.join(dist, relative);
    if (!fs.existsSync(file)) {
        throw new Error(`Missing build output: ${relative}`);
    }
}

const manifestPath = path.join(dist, "manifest.json");
assertFile("manifest.json");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
const csp = manifest.content_security_policy?.extension_pages || "";

if (manifest.manifest_version !== 3) {
    throw new Error("Manifest must use Manifest V3.");
}

if (!manifest.permissions?.includes("offscreen")) {
    throw new Error("Missing offscreen permission in dist/manifest.json.");
}

if (!csp.includes("wasm-unsafe-eval")) {
    throw new Error("Missing 'wasm-unsafe-eval' in extension_pages CSP.");
}

const required = [
    "src/popup/popup.html",
    "src/popup/popup.js",
    "src/popup/popup.css",
    "src/manager/manager.html",
    "src/manager/manager.js",
    "src/manager/manager.css",
    "src/offscreen/offscreen.html",
    "src/offscreen/offscreen.js",
    "src/offscreen/sqlite-client.js",
    "src/background/service-worker.js",
    "src/content/content.js",
    "src/db-worker/sqlite-worker.js",
    "sqlite3.wasm",
    "icon16.png",
    "icon32.png",
    "icon48.png",
    "icon128.png",
];

for (const file of required) {
    assertFile(file);
}

if (
    manifest.background?.service_worker !== "src/background/service-worker.js"
) {
    throw new Error("Manifest background service worker path is incorrect.");
}

if (manifest.action?.default_popup !== "src/popup/popup.html") {
    throw new Error("Manifest popup path is incorrect.");
}

const contentScript = manifest.content_scripts?.[0];
if (!contentScript?.js?.includes("src/content/content.js")) {
    throw new Error("Manifest content script path is incorrect.");
}

const htmlFiles = [
    "src/popup/popup.html",
    "src/manager/manager.html",
    "src/offscreen/offscreen.html",
];

for (const htmlFile of htmlFiles) {
    const html = fs.readFileSync(path.join(dist, htmlFile), "utf8");
    const baseDir = path.dirname(path.join(dist, htmlFile));

    const scripts = [
        ...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi),
    ].map((match) => match[1]);

    for (const script of scripts) {
        const normalized = script.replace(/^\.\//, "");
        assertFile(path.relative(dist, path.join(baseDir, normalized)));
    }

    const styles = [
        ...html.matchAll(/<link[^>]+href=["']([^"']+\.css)["']/gi),
    ].map((match) => match[1]);

    for (const style of styles) {
        const normalized = style.replace(/^\.\//, "");
        assertFile(path.relative(dist, path.join(baseDir, normalized)));
    }
}

const sqliteClient = fs.readFileSync(
    path.join(dist, "src/offscreen/sqlite-client.js"),
    "utf8",
);

if (!sqliteClient.includes("src/db-worker/sqlite-worker.js")) {
    throw new Error(
        "Offscreen SQLite client points to an unexpected worker path.",
    );
}

console.log("Build verification passed.");
