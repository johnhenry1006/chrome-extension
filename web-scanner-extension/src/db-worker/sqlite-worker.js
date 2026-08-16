import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

let dbPromise;
let wasmUrl = null;

function stableNormalize(value) {
    if (Array.isArray(value)) return value.map(stableNormalize);
    if (value && typeof value === "object") {
        return Object.keys(value)
            .sort()
            .reduce((result, key) => {
                result[key] = stableNormalize(value[key]);
                return result;
            }, {});
    }
    return value;
}

function buildScanTypeKey(config) {
    if (!config || typeof config !== "object") return "legacy";
    return JSON.stringify(stableNormalize(config));
}

async function getDb() {
    if (!dbPromise) {
        if (!wasmUrl) {
            throw new Error("SQLite WASM URL has not been initialized.");
        }

        dbPromise = (async () => {
            const sqlite3 = await sqlite3InitModule({
                locateFile: () => wasmUrl,
            });

            const db = new sqlite3.oo1.OpfsDb("/web-scanner.sqlite3");

            db.exec(`
        PRAGMA foreign_keys = ON;

        CREATE TABLE IF NOT EXISTS pages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          url TEXT NOT NULL,
          title TEXT,
          domain TEXT,
          scanned_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS scan_results (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          page_id INTEGER NOT NULL,
          data_json TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          scan_type_key TEXT,
          FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_pages_url ON pages(url);
        CREATE INDEX IF NOT EXISTS idx_pages_domain ON pages(domain);
        CREATE INDEX IF NOT EXISTS idx_results_page_id ON scan_results(page_id);
        CREATE INDEX IF NOT EXISTS idx_results_created_at ON scan_results(created_at);
      `);

            // Keep existing databases backward-compatible when config_json is added.
            const columns = db.exec({
                sql: "PRAGMA table_info(scan_results)",
                returnValue: "resultRows",
                rowMode: "object",
            });

            if (!columns.some((column) => column.name === "config_json")) {
                db.exec("ALTER TABLE scan_results ADD COLUMN config_json TEXT");
            }

            if (!columns.some((column) => column.name === "scan_type_key")) {
                db.exec(
                    "ALTER TABLE scan_results ADD COLUMN scan_type_key TEXT",
                );
            }

            // Backfill classification for records created before scan_type_key existed.
            const unclassifiedRows = db.exec({
                sql: `
          SELECT id, config_json
          FROM scan_results
          WHERE scan_type_key IS NULL
        `,
                returnValue: "resultRows",
                rowMode: "object",
            });

            for (const row of unclassifiedRows) {
                let key = "legacy";

                if (row.config_json) {
                    try {
                        key = buildScanTypeKey(JSON.parse(row.config_json));
                    } catch {
                        key = "legacy";
                    }
                }

                db.exec({
                    sql: "UPDATE scan_results SET scan_type_key = ? WHERE id = ?",
                    bind: [key, row.id],
                });
            }

            db.exec(
                "CREATE INDEX IF NOT EXISTS idx_results_type_key ON scan_results(scan_type_key)",
            );

            return db;
        })().catch((error) => {
            dbPromise = null;
            throw error;
        });
    }

    return dbPromise;
}

async function handle(request) {
    const db = await getDb();

    switch (request.action) {
        case "ping":
            return { sqlite: true, persistent: true };

        case "save_scan": {
            const now = Date.now();
            let pageId;
            let resultId;

            db.exec("BEGIN");

            try {
                db.exec({
                    sql: `
            INSERT INTO pages (url, title, domain, scanned_at)
            VALUES (?, ?, ?, ?)
          `,
                    bind: [
                        request.page.url,
                        request.page.title || null,
                        request.page.domain || null,
                        now,
                    ],
                });

                pageId = db.selectValue("SELECT last_insert_rowid()");

                db.exec({
                    sql: `
            INSERT INTO scan_results (page_id, data_json, config_json, created_at, scan_type_key)
            VALUES (?, ?, ?, ?, ?)
          `,
                    bind: [
                        pageId,
                        JSON.stringify(request.data),
                        request.config ? JSON.stringify(request.config) : null,
                        now,
                        request.scanTypeKey || buildScanTypeKey(request.config),
                    ],
                });

                resultId = db.selectValue("SELECT last_insert_rowid()");
                db.exec("COMMIT");
            } catch (error) {
                try {
                    db.exec("ROLLBACK");
                } catch {
                    // Ignore rollback errors and report the original error.
                }
                throw error;
            }

            return { pageId, resultId };
        }

        case "get_saved": {
            const resultId = Number(request.resultId);

            if (!Number.isInteger(resultId) || resultId <= 0) {
                throw new Error("Invalid saved record ID.");
            }

            const rows = db.exec({
                sql: `
          SELECT
            sr.id AS result_id,
            p.id AS page_id,
            p.url,
            p.title,
            p.domain,
            p.scanned_at,
            sr.created_at,
            sr.data_json,
            sr.config_json,
            sr.scan_type_key
          FROM scan_results sr
          INNER JOIN pages p ON p.id = sr.page_id
          WHERE sr.id = ?
          LIMIT 1
        `,
                bind: [resultId],
                returnValue: "resultRows",
                rowMode: "object",
            });

            return rows[0] || null;
        }

        case "list_saved": {
            const limit = Math.min(
                Math.max(Number(request.limit) || 20, 1),
                1000,
            );

            return db.exec({
                sql: `
          SELECT
            sr.id AS result_id,
            p.id AS page_id,
            p.url,
            p.title,
            p.domain,
            p.scanned_at,
            sr.created_at,
            sr.data_json,
            sr.config_json,
            sr.scan_type_key
          FROM scan_results sr
          INNER JOIN pages p ON p.id = sr.page_id
          ORDER BY sr.created_at DESC
          LIMIT ?
        `,
                bind: [limit],
                returnValue: "resultRows",
                rowMode: "object",
            });
        }

        case "get_saved_navigation": {
            const resultId = Number(request.resultId);

            if (!Number.isInteger(resultId) || resultId <= 0) {
                throw new Error("Invalid saved record ID.");
            }

            const current = db.exec({
                sql: `
          SELECT
            sr.id AS result_id,
            p.domain,
            sr.scan_type_key,
            sr.created_at
          FROM scan_results sr
          INNER JOIN pages p ON p.id = sr.page_id
          WHERE sr.id = ?
          LIMIT 1
        `,
                bind: [resultId],
                returnValue: "resultRows",
                rowMode: "object",
            })[0];

            if (!current) return null;

            const sameDomainAndType =
                request.filterMode === "same-domain-scan-type";
            const whereClause = sameDomainAndType
                ? "WHERE p.domain = ? AND sr.scan_type_key = ?"
                : "";
            const bind = sameDomainAndType
                ? [current.domain || "", current.scan_type_key || "legacy"]
                : [];

            const rows = db.exec({
                sql: `
          SELECT
            sr.id AS result_id,
            p.title,
            p.url,
            p.domain,
            sr.scan_type_key,
            sr.created_at
          FROM scan_results sr
          INNER JOIN pages p ON p.id = sr.page_id
          ${whereClause}
          ORDER BY sr.created_at ASC, sr.id ASC
        `,
                bind,
                returnValue: "resultRows",
                rowMode: "object",
            });

            const index = rows.findIndex(
                (row) => Number(row.result_id) === resultId,
            );
            if (index < 0) {
                return {
                    current: null,
                    previous: null,
                    next: null,
                    total: 0,
                    position: 0,
                };
            }

            return {
                current: rows[index],
                previous: rows[index - 1] || null,
                next: rows[index + 1] || null,
                total: rows.length,
                position: index + 1,
                domain: current.domain || "Unknown domain",
                scanTypeKey: current.scan_type_key || "legacy",
                filterMode: sameDomainAndType ? "same-domain-scan-type" : "all",
            };
        }

        case "delete_saved": {
            const ids = Array.isArray(request.resultIds)
                ? [
                      ...new Set(
                          request.resultIds
                              .map(Number)
                              .filter(Number.isInteger),
                      ),
                  ]
                : [];

            if (!ids.length) {
                return { deletedCount: 0, deletedPageCount: 0 };
            }

            const placeholders = ids.map(() => "?").join(", ");
            let deletedCount = 0;
            let deletedPageCount = 0;

            db.exec("BEGIN");

            try {
                const pageRows = db.exec({
                    sql: `
            SELECT DISTINCT page_id
            FROM scan_results
            WHERE id IN (${placeholders})
          `,
                    bind: ids,
                    returnValue: "resultRows",
                    rowMode: "object",
                });

                db.exec({
                    sql: `
            DELETE FROM scan_results
            WHERE id IN (${placeholders})
          `,
                    bind: ids,
                });

                deletedCount = db.selectValue("SELECT changes()");

                for (const row of pageRows) {
                    const remaining = db.selectValue(
                        "SELECT COUNT(*) FROM scan_results WHERE page_id = ?",
                        [row.page_id],
                    );

                    if (Number(remaining) === 0) {
                        db.exec({
                            sql: "DELETE FROM pages WHERE id = ?",
                            bind: [row.page_id],
                        });
                        deletedPageCount += 1;
                    }
                }

                db.exec("COMMIT");
            } catch (error) {
                try {
                    db.exec("ROLLBACK");
                } catch {
                    // Ignore rollback errors and report the original error.
                }
                throw error;
            }

            return { deletedCount, deletedPageCount };
        }

        default:
            throw new Error(`Unknown SQLite action: ${request.action}`);
    }
}

self.addEventListener("message", async (event) => {
    const message = event.data || {};

    if (message.type === "INIT") {
        try {
            wasmUrl = message.wasmUrl;

            if (!wasmUrl) {
                throw new Error("Missing SQLite WASM URL.");
            }

            await getDb();

            self.postMessage({ type: "READY" });
        } catch (error) {
            self.postMessage({
                type: "INIT_ERROR",
                error: error?.message || String(error),
            });
        }

        return;
    }

    const { id, request } = message;
    if (!id || !request) return;

    try {
        const result = await handle(request);
        self.postMessage({ id, success: true, result });
    } catch (error) {
        self.postMessage({
            id,
            success: false,
            error: error?.message || String(error),
        });
    }
});
