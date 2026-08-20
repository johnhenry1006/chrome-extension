import sqlite3InitModule from "@sqlite.org/sqlite-wasm";

let dbPromise;
let wasmUrl = null;

function buildScanTypeKey(config) {
    if (!config || typeof config !== "object") return "legacy";

    const fields =
        config.fields && typeof config.fields === "object"
            ? Object.keys(config.fields)
                  .sort()
                  .reduce((result, name) => {
                      const field = config.fields[name] || {};
                      result[name] = {
                          type: field.type || "text",
                          scope: field.scope || "root",
                          attribute:
                              field.type === "attribute"
                                  ? field.attribute || ""
                                  : "",
                      };
                      return result;
                  }, {})
            : {};

    return JSON.stringify({
        mode: config.mode || "single",
        fields,
    });
}

function normalizeDomain(domain) {
    return String(domain || "")
        .trim()
        .toLowerCase()
        .replace(/^www\./, "");
}

function normalizeGroupName(value) {
    return String(value ?? "")
        .replace(/\s+/g, " ")
        .trim();
}

function buildGroupKey(value) {
    const name = normalizeGroupName(value);
    if (!name) return null;

    const ascii = name
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    return ascii || name.toLowerCase();
}

function legacyGroupFromConfig(config) {
    if (!config?.group || typeof config.group !== "object") return null;
    if (config.group.type === "constant")
        return normalizeGroupName(config.group.value);
    return null;
}

async function getDb() {
    if (!dbPromise) {
        if (!wasmUrl)
            throw new Error("SQLite WASM URL has not been initialized.");

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

        CREATE TABLE IF NOT EXISTS story_groups (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          domain TEXT NOT NULL,
          group_key TEXT NOT NULL,
          group_name TEXT NOT NULL,
          cover_url TEXT,
          description TEXT,
          author TEXT,
          categories_json TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          UNIQUE(domain, group_key)
        );

        CREATE TABLE IF NOT EXISTS reader_states (
          result_id INTEGER PRIMARY KEY,
          is_read INTEGER NOT NULL DEFAULT 0,
          is_bookmarked INTEGER NOT NULL DEFAULT 0,
          read_at INTEGER,
          updated_at INTEGER NOT NULL,
          FOREIGN KEY(result_id) REFERENCES scan_results(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_story_groups_domain ON story_groups(domain);
        CREATE INDEX IF NOT EXISTS idx_story_groups_updated_at ON story_groups(updated_at);
        CREATE INDEX IF NOT EXISTS idx_reader_states_bookmark ON reader_states(is_bookmarked);
        CREATE INDEX IF NOT EXISTS idx_pages_url ON pages(url);
        CREATE INDEX IF NOT EXISTS idx_pages_domain ON pages(domain);
        CREATE INDEX IF NOT EXISTS idx_results_page_id ON scan_results(page_id);
        CREATE INDEX IF NOT EXISTS idx_results_created_at ON scan_results(created_at);
      `);

            // Migrate story_groups as well. CREATE TABLE IF NOT EXISTS does not add
            // columns to an existing database created by an older extension version.
            let storyColumns = db.exec({
                sql: "PRAGMA table_info(story_groups)",
                returnValue: "resultRows",
                rowMode: "object",
            });

            const storyColumnDefaults = {
                cover_url: "TEXT",
                description: "TEXT",
                author: "TEXT",
                categories_json: "TEXT",
            };

            for (const [name, type] of Object.entries(storyColumnDefaults)) {
                if (!storyColumns.some((column) => column.name === name)) {
                    db.exec(
                        `ALTER TABLE story_groups ADD COLUMN ${name} ${type}`,
                    );
                }
            }

            // Re-read after migration.
            storyColumns = db.exec({
                sql: "PRAGMA table_info(story_groups)",
                returnValue: "resultRows",
                rowMode: "object",
            });

            let columns = db.exec({
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
            if (!columns.some((column) => column.name === "group_name")) {
                db.exec("ALTER TABLE scan_results ADD COLUMN group_name TEXT");
            }
            if (!columns.some((column) => column.name === "group_key")) {
                db.exec("ALTER TABLE scan_results ADD COLUMN group_key TEXT");
            }

            // Re-read columns after migration so subsequent logic sees the final schema.
            columns = db.exec({
                sql: "PRAGMA table_info(scan_results)",
                returnValue: "resultRows",
                rowMode: "object",
            });

            const unclassified = db.exec({
                sql: `
          SELECT id, config_json, scan_type_key, group_name, group_key
          FROM scan_results
          WHERE scan_type_key IS NULL OR group_key IS NULL
        `,
                returnValue: "resultRows",
                rowMode: "object",
            });

            for (const row of unclassified) {
                let scanTypeKey = row.scan_type_key || "legacy";
                let groupName = normalizeGroupName(row.group_name);
                let groupKey = row.group_key || null;

                if (row.config_json) {
                    try {
                        const config = JSON.parse(row.config_json);
                        if (!row.scan_type_key)
                            scanTypeKey = buildScanTypeKey(config);
                        if (!groupName)
                            groupName = legacyGroupFromConfig(config) || "";
                        if (!groupKey && groupName)
                            groupKey = buildGroupKey(groupName);
                    } catch {
                        // Keep legacy values when old JSON is invalid.
                    }
                }

                db.exec({
                    sql: `
            UPDATE scan_results
            SET scan_type_key = ?, group_name = ?, group_key = ?
            WHERE id = ?
          `,
                    bind: [scanTypeKey, groupName || null, groupKey, row.id],
                });
            }

            db.exec(
                "CREATE UNIQUE INDEX IF NOT EXISTS uq_story_groups_domain_key ON story_groups(domain, group_key)",
            );

            db.exec(
                "CREATE INDEX IF NOT EXISTS idx_results_type_key ON scan_results(scan_type_key)",
            );
            db.exec(
                "CREATE INDEX IF NOT EXISTS idx_results_group_key ON scan_results(group_key)",
            );
            db.exec(
                "CREATE INDEX IF NOT EXISTS idx_results_group_domain ON scan_results(group_key, page_id)",
            );

            const groupedRows = db.exec({
                sql: `
          SELECT sr.group_key, MAX(sr.group_name) AS group_name,
                 MIN(lower(replace(trim(COALESCE(p.domain, '')), 'www.', ''))) AS domain,
                 MIN(sr.created_at) AS created_at, MAX(sr.created_at) AS updated_at
          FROM scan_results sr
          INNER JOIN pages p ON p.id = sr.page_id
          WHERE sr.group_key IS NOT NULL AND sr.group_name IS NOT NULL
          GROUP BY sr.group_key, lower(replace(trim(COALESCE(p.domain, '')), 'www.', ''))
        `,
                returnValue: "resultRows",
                rowMode: "object",
            });

            for (const row of groupedRows) {
                const storyDomain = row.domain || "unknown";
                const existingStory = db.exec({
                    sql: `SELECT id, updated_at FROM story_groups WHERE domain = ? AND group_key = ? LIMIT 1`,
                    bind: [storyDomain, row.group_key],
                    returnValue: "resultRows",
                    rowMode: "object",
                })[0];

                if (existingStory) {
                    db.exec({
                        sql: `
              UPDATE story_groups
              SET group_name = ?,
                  updated_at = MAX(COALESCE(updated_at, 0), ?)
              WHERE id = ?
            `,
                        bind: [
                            row.group_name,
                            row.updated_at || Date.now(),
                            existingStory.id,
                        ],
                    });
                } else {
                    db.exec({
                        sql: `
              INSERT INTO story_groups (domain, group_key, group_name, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?)
            `,
                        bind: [
                            storyDomain,
                            row.group_key,
                            row.group_name,
                            row.created_at || Date.now(),
                            row.updated_at || Date.now(),
                        ],
                    });
                }
            }

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
            const groupName = normalizeGroupName(request.groupName);
            const groupKey = request.groupKey || buildGroupKey(groupName);

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
                        normalizeDomain(request.page.domain) || null,
                        now,
                    ],
                });

                pageId = db.selectValue("SELECT last_insert_rowid()");

                db.exec({
                    sql: `
            INSERT INTO scan_results (
              page_id,
              data_json,
              config_json,
              created_at,
              scan_type_key,
              group_name,
              group_key
            )
            VALUES (?, ?, ?, ?, ?, ?, ?)
          `,
                    bind: [
                        pageId,
                        JSON.stringify(request.data),
                        request.config ? JSON.stringify(request.config) : null,
                        now,
                        request.scanTypeKey || buildScanTypeKey(request.config),
                        groupName || null,
                        groupKey,
                    ],
                });

                resultId = db.selectValue("SELECT last_insert_rowid()");

                if (groupKey && groupName) {
                    db.exec({
                        sql: `
              INSERT INTO story_groups (domain, group_key, group_name, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?)
              ON CONFLICT(domain, group_key)
              DO UPDATE SET group_name = excluded.group_name, updated_at = excluded.updated_at
            `,
                        bind: [
                            normalizeDomain(request.page.domain),
                            groupKey,
                            groupName,
                            now,
                            now,
                        ],
                    });
                }

                db.exec("COMMIT");
            } catch (error) {
                try {
                    db.exec("ROLLBACK");
                } catch {}
                throw error;
            }

            return { pageId, resultId, groupName: groupName || null, groupKey };
        }

        case "get_saved": {
            const resultId = Number(request.resultId);
            if (!Number.isInteger(resultId) || resultId <= 0)
                throw new Error("Invalid saved record ID.");

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
            sr.scan_type_key,
            sr.group_name,
            sr.group_key,
            COALESCE(rs.is_read, 0) AS is_read,
            COALESCE(rs.is_bookmarked, 0) AS is_bookmarked,
            rs.read_at
          FROM scan_results sr
          LEFT JOIN reader_states rs ON rs.result_id = sr.id
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
            sr.scan_type_key,
            sr.group_name,
            sr.group_key,
            COALESCE(rs.is_read, 0) AS is_read,
            COALESCE(rs.is_bookmarked, 0) AS is_bookmarked,
            rs.read_at
          FROM scan_results sr
          LEFT JOIN reader_states rs ON rs.result_id = sr.id
          INNER JOIN pages p ON p.id = sr.page_id
          ORDER BY sr.created_at DESC, sr.id DESC
          LIMIT ?
        `,
                bind: [limit],
                returnValue: "resultRows",
                rowMode: "object",
            });
        }

        case "get_saved_navigation": {
            const resultId = Number(request.resultId);
            if (!Number.isInteger(resultId) || resultId <= 0)
                throw new Error("Invalid saved record ID.");

            const current = db.exec({
                sql: `
          SELECT
            sr.id AS result_id,
            p.domain,
            sr.scan_type_key,
            sr.group_name,
            sr.group_key,
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

            const mode = request.filterMode || "all";
            const normalizedDomain = normalizeDomain(current.domain);
            const groupKey = current.group_key || null;
            const scanTypeKey = current.scan_type_key || "legacy";

            let whereClause = "";
            let bind = [];
            let filterLabel = "All saved pages";

            switch (mode) {
                case "same-group":
                    whereClause =
                        "WHERE sr.group_key IS NOT NULL AND sr.group_key = ?";
                    bind = [groupKey];
                    filterLabel = "Same story / group";
                    break;
                case "same-domain":
                    whereClause = `WHERE lower(replace(trim(COALESCE(p.domain, '')), 'www.', '')) = ?`;
                    bind = [normalizedDomain];
                    filterLabel = "Same domain";
                    break;
                case "same-domain-group":
                    if (groupKey) {
                        whereClause = `WHERE lower(replace(trim(COALESCE(p.domain, '')), 'www.', '')) = ? AND sr.group_key = ?`;
                        bind = [normalizedDomain, groupKey];
                    } else {
                        whereClause = `WHERE lower(replace(trim(COALESCE(p.domain, '')), 'www.', '')) = ? AND sr.group_key IS NULL`;
                        bind = [normalizedDomain];
                    }
                    filterLabel = "Same domain + same story / group";
                    break;
                case "same-domain-scan-type":
                    whereClause = `WHERE lower(replace(trim(COALESCE(p.domain, '')), 'www.', '')) = ? AND COALESCE(sr.scan_type_key, 'legacy') = ?`;
                    bind = [normalizedDomain, scanTypeKey];
                    filterLabel = "Same domain + same scan type";
                    break;
                case "all":
                default:
                    break;
            }

            const rows = db.exec({
                sql: `
          SELECT
            sr.id AS result_id,
            p.title,
            p.url,
            p.domain,
            sr.scan_type_key,
            sr.group_name,
            sr.group_key,
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
                    filterMode: mode,
                    filterLabel,
                };
            }

            return {
                current: rows[index],
                previous: rows[index - 1] || null,
                next: rows[index + 1] || null,
                total: rows.length,
                position: index + 1,
                pages: rows.map((row, pageIndex) => ({
                    result_id: Number(row.result_id),
                    title: row.title || "",
                    url: row.url || "",
                    position: pageIndex + 1,
                })),
                domain: normalizedDomain || "Unknown domain",
                groupName: current.group_name || null,
                groupKey,
                scanTypeKey,
                filterMode: mode,
                filterLabel,
            };
        }

        case "list_stories": {
            const limit = Math.min(
                Math.max(Number(request.limit) || 100, 1),
                1000,
            );
            const search = String(request.search || "")
                .trim()
                .toLowerCase();
            const sort = request.sort || "updated-desc";
            const orderBy =
                {
                    "updated-desc": "sg.updated_at DESC, sg.id DESC",
                    "updated-asc": "sg.updated_at ASC, sg.id ASC",
                    "name-asc": "sg.group_name COLLATE NOCASE ASC, sg.id ASC",
                    "name-desc":
                        "sg.group_name COLLATE NOCASE DESC, sg.id DESC",
                    "pages-desc":
                        "page_count DESC, sg.group_name COLLATE NOCASE ASC, sg.id ASC",
                    "pages-asc":
                        "page_count ASC, sg.group_name COLLATE NOCASE ASC, sg.id ASC",
                }[sort] || "sg.updated_at DESC, sg.id DESC";

            const where = search
                ? `WHERE lower(COALESCE(sg.group_name, '')) LIKE ?
            OR lower(COALESCE(sg.domain, '')) LIKE ?`
                : "";
            const bind = search
                ? [`%${search}%`, `%${search}%`, limit]
                : [limit];

            return db.exec({
                sql: `
          SELECT
            sg.id AS story_id,
            sg.domain,
            sg.group_key,
            sg.group_name,
            sg.cover_url,
            sg.description,
            sg.author,
            sg.categories_json,
            sg.created_at,
            sg.updated_at,
            COUNT(DISTINCT sr.id) AS page_count,
            COALESCE(SUM(
              CASE WHEN COALESCE(rs.is_read, 0) = 1 THEN 1 ELSE 0 END
            ), 0) AS read_count,
            COALESCE(SUM(
              CASE WHEN COALESCE(rs.is_bookmarked, 0) = 1 THEN 1 ELSE 0 END
            ), 0) AS bookmark_count,
            MAX(sr.created_at) AS last_saved_at
          FROM story_groups sg
          LEFT JOIN scan_results sr
            ON sr.group_key = sg.group_key
           AND EXISTS (
             SELECT 1 FROM pages sp
             WHERE sp.id = sr.page_id
               AND lower(replace(trim(COALESCE(sp.domain, '')), 'www.', '')) = sg.domain
           )
          LEFT JOIN pages p
            ON p.id = sr.page_id
           AND lower(replace(trim(COALESCE(p.domain, '')), 'www.', '')) = sg.domain
          LEFT JOIN reader_states rs
            ON rs.result_id = sr.id
          ${where}
          GROUP BY
            sg.id,
            sg.domain,
            sg.group_key,
            sg.group_name,
            sg.cover_url,
            sg.description,
            sg.author,
            sg.categories_json,
            sg.created_at,
            sg.updated_at
          ORDER BY ${orderBy}
          LIMIT ?
        `,
                bind,
                returnValue: "resultRows",
                rowMode: "object",
            });
        }

        case "get_story": {
            const storyId = Number(request.storyId);
            if (!Number.isInteger(storyId) || storyId <= 0)
                throw new Error("Invalid story ID.");
            return (
                db.exec({
                    sql: `
          SELECT sg.id AS story_id, sg.domain, sg.group_key, sg.group_name,
                 sg.cover_url, sg.description, sg.author, sg.categories_json,
                 sg.created_at, sg.updated_at,
                 COUNT(p.id) AS page_count,
                 SUM(CASE WHEN p.id IS NOT NULL AND COALESCE(rs.is_read, 0) = 1 THEN 1 ELSE 0 END) AS read_count,
                 SUM(CASE WHEN p.id IS NOT NULL AND COALESCE(rs.is_bookmarked, 0) = 1 THEN 1 ELSE 0 END) AS bookmark_count,
                 MAX(sr.created_at) AS last_saved_at
          FROM story_groups sg
          LEFT JOIN scan_results sr ON sr.group_key = sg.group_key
            AND EXISTS (SELECT 1 FROM pages sp WHERE sp.id = sr.page_id
              AND lower(replace(trim(COALESCE(sp.domain, '')), 'www.', '')) = sg.domain)
          LEFT JOIN pages p ON p.id = sr.page_id
            AND lower(replace(trim(COALESCE(p.domain, '')), 'www.', '')) = sg.domain
          LEFT JOIN reader_states rs ON rs.result_id = sr.id
          WHERE sg.id = ?
          GROUP BY sg.id LIMIT 1
        `,
                    bind: [storyId],
                    returnValue: "resultRows",
                    rowMode: "object",
                })[0] || null
            );
        }

        case "list_story_pages": {
            const storyId = Number(request.storyId);
            if (!Number.isInteger(storyId) || storyId <= 0)
                throw new Error("Invalid story ID.");
            const story = db.exec({
                sql: "SELECT domain, group_key FROM story_groups WHERE id = ? LIMIT 1",
                bind: [storyId],
                returnValue: "resultRows",
                rowMode: "object",
            })[0];
            if (!story) return [];
            const rows = db.exec({
                sql: `
          SELECT sr.id AS result_id, p.id AS page_id, p.title, p.url, p.domain,
                 sr.created_at, COALESCE(rs.is_read, 0) AS is_read,
                 COALESCE(rs.is_bookmarked, 0) AS is_bookmarked, rs.read_at
          FROM scan_results sr
          INNER JOIN pages p ON p.id = sr.page_id
          LEFT JOIN reader_states rs ON rs.result_id = sr.id
          WHERE sr.group_key = ?
            AND lower(replace(trim(COALESCE(p.domain, '')), 'www.', '')) = ?
          ORDER BY sr.created_at ASC, sr.id ASC
        `,
                bind: [story.group_key, story.domain],
                returnValue: "resultRows",
                rowMode: "object",
            });
            return rows.map((row, index) => ({ ...row, position: index + 1 }));
        }

        case "update_story": {
            const storyId = Number(request.storyId);
            if (!Number.isInteger(storyId) || storyId <= 0)
                throw new Error("Invalid story ID.");
            const fields = [
                "group_name",
                "cover_url",
                "description",
                "author",
                "categories_json",
            ];
            const updates = [],
                bind = [];
            for (const field of fields) {
                if (Object.prototype.hasOwnProperty.call(request, field)) {
                    updates.push(`${field} = ?`);
                    bind.push(
                        request[field] == null ? null : String(request[field]),
                    );
                }
            }
            if (!updates.length) return { updated: false };
            updates.push("updated_at = ?");
            bind.push(Date.now(), storyId);
            db.exec({
                sql: `UPDATE story_groups SET ${updates.join(", ")} WHERE id = ?`,
                bind,
            });
            return { updated: Number(db.selectValue("SELECT changes()")) > 0 };
        }

        case "toggle_reader_state": {
            const resultId = Number(request.resultId);
            if (!Number.isInteger(resultId) || resultId <= 0)
                throw new Error("Invalid result ID.");
            const current = db.exec({
                sql: "SELECT is_read, is_bookmarked FROM reader_states WHERE result_id = ? LIMIT 1",
                bind: [resultId],
                returnValue: "resultRows",
                rowMode: "object",
            })[0] || { is_read: 0, is_bookmarked: 0 };
            const isRead =
                request.isRead === undefined
                    ? Number(current.is_read)
                    : request.isRead
                      ? 1
                      : 0;
            const isBookmarked =
                request.isBookmarked === undefined
                    ? Number(current.is_bookmarked)
                    : request.isBookmarked
                      ? 1
                      : 0;
            const now = Date.now();
            db.exec({
                sql: `
          INSERT INTO reader_states (result_id, is_read, is_bookmarked, read_at, updated_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(result_id) DO UPDATE SET
            is_read = excluded.is_read, is_bookmarked = excluded.is_bookmarked,
            read_at = excluded.read_at, updated_at = excluded.updated_at
        `,
                bind: [
                    resultId,
                    isRead,
                    isBookmarked,
                    isRead ? now : null,
                    now,
                ],
            });
            return {
                resultId,
                isRead: Boolean(isRead),
                isBookmarked: Boolean(isBookmarked),
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
            if (!ids.length) return { deletedCount: 0, deletedPageCount: 0 };

            const placeholders = ids.map(() => "?").join(", ");
            let deletedCount = 0;
            let deletedPageCount = 0;

            db.exec("BEGIN");
            try {
                const pageRows = db.exec({
                    sql: `SELECT DISTINCT page_id FROM scan_results WHERE id IN (${placeholders})`,
                    bind: ids,
                    returnValue: "resultRows",
                    rowMode: "object",
                });

                db.exec({
                    sql: `DELETE FROM scan_results WHERE id IN (${placeholders})`,
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

                db.exec(`
          DELETE FROM story_groups
          WHERE NOT EXISTS (
            SELECT 1
            FROM scan_results sr
            INNER JOIN pages p ON p.id = sr.page_id
            WHERE sr.group_key = story_groups.group_key
              AND lower(replace(trim(COALESCE(p.domain, '')), 'www.', '')) = story_groups.domain
          )
        `);

                db.exec("COMMIT");
            } catch (error) {
                try {
                    db.exec("ROLLBACK");
                } catch {}
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
            if (!wasmUrl) throw new Error("Missing SQLite WASM URL.");
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
