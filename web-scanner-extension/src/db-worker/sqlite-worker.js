import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

let dbPromise;
let wasmUrl = null;

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
          FOREIGN KEY(page_id) REFERENCES pages(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_pages_url ON pages(url);
        CREATE INDEX IF NOT EXISTS idx_pages_domain ON pages(domain);
        CREATE INDEX IF NOT EXISTS idx_results_page_id ON scan_results(page_id);
        CREATE INDEX IF NOT EXISTS idx_results_created_at ON scan_results(created_at);
      `);

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
            INSERT INTO scan_results (page_id, data_json, created_at)
            VALUES (?, ?, ?)
          `,
                    bind: [pageId, JSON.stringify(request.data), now],
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
            sr.data_json
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
