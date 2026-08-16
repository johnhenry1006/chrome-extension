const $ = (id) => document.getElementById(id);

let savedRow = null;
let navigation = null;
let contentText = "";
let jsonText = "";

function status(message) {
    $("status").textContent = message || "";
}

function parseJson(value, fallback = null) {
    if (value == null || value === "") return fallback;
    try {
        return JSON.parse(value);
    } catch {
        return fallback;
    }
}

function parseData(row) {
    return parseJson(row.data_json, row.data_json || null);
}

function parseConfig(row) {
    return parseJson(row.config_json, null);
}

function extractContent(data) {
    if (typeof data === "string") return data;
    if (!data || typeof data !== "object") return "";
    if (typeof data.content === "string") return data.content;
    if (Array.isArray(data)) {
        return data
            .map((item) => extractContent(item))
            .filter(Boolean)
            .join("\n\n");
    }
    return "";
}

function formatDate(value) {
    if (!value) return "-";
    return new Date(Number(value)).toLocaleString();
}

async function copyText(text, button, successLabel) {
    try {
        await navigator.clipboard.writeText(text);
        const original = button.textContent;
        button.textContent = successLabel;
        setTimeout(() => {
            button.textContent = original;
        }, 1200);
    } catch (error) {
        status(error?.message || String(error));
    }
}

function normalizeType(field) {
    return field?.type || "text";
}

function valueForField(item, fieldName) {
    if (!item || typeof item !== "object") return item;
    return item[fieldName];
}

function createTextRenderer(value, type) {
    const pre = document.createElement("pre");
    pre.className = `field-value field-${type}`;
    pre.textContent = value == null ? "" : String(value);
    return pre;
}

function sanitizeHtml(html) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(String(html || ""), "text/html");

    doc.querySelectorAll(
        'script, iframe, frame, frameset, object, embed, applet, base, form, input, button, textarea, select, link[rel="import"]',
    ).forEach((node) => node.remove());

    doc.querySelectorAll("*").forEach((node) => {
        [...node.attributes].forEach((attribute) => {
            const name = attribute.name.toLowerCase();
            const value = attribute.value.trim();

            if (name.startsWith("on")) {
                node.removeAttribute(attribute.name);
                return;
            }

            if (
                (name === "href" ||
                    name === "src" ||
                    name === "action" ||
                    name === "formaction") &&
                /^(?:javascript|vbscript):/i.test(value)
            ) {
                node.removeAttribute(attribute.name);
                return;
            }

            if (name === "src" || name === "href") {
                const allowed =
                    /^(?:data:image\/|data:font\/|data:application\/|#)/i.test(
                        value,
                    );
                if (!allowed) node.removeAttribute(attribute.name);
            }

            if (name === "style") {
                node.setAttribute(
                    attribute.name,
                    value
                        .replace(/@import\s+[^;]+;?/gi, "")
                        .replace(
                            /url\s*\(\s*(['"]?)(?!data:)[^)]*\1\s*\)/gi,
                            "none",
                        ),
                );
            }
        });
    });

    doc.querySelectorAll("style").forEach((style) => {
        style.textContent = style.textContent
            .replace(/@import\s+[^;]+;?/gi, "")
            .replace(/url\s*\(\s*(['"]?)(?!data:)[^)]*\1\s*\)/gi, "none");
    });

    return doc.body.innerHTML;
}

function createHtmlRenderer(value) {
    const frame = document.createElement("iframe");
    frame.className = "html-preview";
    frame.setAttribute("sandbox", "");
    frame.setAttribute("referrerpolicy", "no-referrer");

    const safeHtml = sanitizeHtml(value);
    frame.srcdoc = `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; font-src data:; style-src 'unsafe-inline';">
<style>
  html, body { margin: 0; padding: 0; }
  body { font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; line-height: 1.6; color: #111827; background: #fff; padding: 20px; overflow-wrap: anywhere; }
  img { max-width: 100%; height: auto; }
  pre { white-space: pre-wrap; overflow-wrap: anywhere; }
  table { max-width: 100%; border-collapse: collapse; }
  td, th { border: 1px solid #d1d5db; padding: 6px 8px; }
</style>
</head>
<body>${safeHtml}</body>
</html>`;

    return frame;
}

function createFieldCard(fieldName, field, value, index = null) {
    const card = document.createElement("section");
    card.className = "field-card";

    const header = document.createElement("div");
    header.className = "field-header";

    const title = document.createElement("h3");
    title.textContent = fieldName;

    const type = normalizeType(field);
    const badge = document.createElement("span");
    badge.className = "type-badge";
    badge.textContent = type;

    header.append(title, badge);

    if (index !== null) {
        const indexBadge = document.createElement("span");
        indexBadge.className = "index-badge";
        indexBadge.textContent = `Item ${index + 1}`;
        header.append(indexBadge);
    }

    card.appendChild(header);

    if (type === "html" && typeof value === "string") {
        card.appendChild(createHtmlRenderer(value));
    } else {
        card.appendChild(createTextRenderer(value, type));
    }

    return card;
}

function renderConfiguredData(data, config) {
    const container = $("renderedFields");
    container.replaceChildren();

    if (!config?.fields || typeof config.fields !== "object") {
        const fallback = document.createElement("div");
        fallback.className = "fallback-message";
        fallback.textContent =
            "This saved record does not contain scanner configuration. Showing content as plain text.";
        container.appendChild(fallback);
        container.appendChild(createTextRenderer(extractContent(data), "text"));
        return;
    }

    const items = config.mode === "list" && Array.isArray(data) ? data : [data];

    items.forEach((item, index) => {
        const itemContainer = document.createElement("div");
        itemContainer.className = "scan-item";

        if (config.mode === "list") {
            const heading = document.createElement("div");
            heading.className = "item-heading";
            heading.textContent = `Item ${index + 1}`;
            itemContainer.appendChild(heading);
        }

        for (const [fieldName, field] of Object.entries(config.fields)) {
            const value = valueForField(item, fieldName);
            itemContainer.appendChild(
                createFieldCard(
                    fieldName,
                    field || {},
                    value,
                    config.mode === "list" ? index : null,
                ),
            );
        }

        container.appendChild(itemContainer);
    });
}

function navigationFilterMode() {
    return $("navigationFilter").value === "same-domain-scan-type"
        ? "same-domain-scan-type"
        : "all";
}

function navigationFilterLabel() {
    return navigationFilterMode() === "same-domain-scan-type"
        ? "Same domain + same scan type"
        : "All saved pages";
}

function renderNavigation() {
    const previous = navigation?.previous;
    const next = navigation?.next;
    const total = Number(navigation?.total || 0);
    const position = Number(navigation?.position || 0);

    $("navigationInfo").textContent = total
        ? `${position} of ${total} · ${navigationFilterLabel()}`
        : "No related saved pages.";

    $("navigationFilter").value =
        navigation?.filterMode || navigationFilterMode();

    $("previousPage").disabled = !previous;
    $("nextPage").disabled = !next;
    $("previousPage").title = previous
        ? `Previous: ${previous.title || previous.url}`
        : "No previous page";
    $("nextPage").title = next
        ? `Next: ${next.title || next.url}`
        : "No next page";
}

async function loadNavigation(resultId) {
    const response = await chrome.runtime.sendMessage({
        type: "DB_GET_SAVED_NAVIGATION",
        resultId,
        filterMode: navigationFilterMode(),
    });

    if (!response?.success) {
        throw new Error(response?.error || "Failed to load page navigation.");
    }

    navigation = response.result;
    renderNavigation();
}

async function openOffline(resultId, filterMode = navigationFilterMode()) {
    if (!resultId) return;
    const params = new URLSearchParams({
        resultId: String(Number(resultId)),
        filter: filterMode,
    });
    const url = chrome.runtime.getURL(
        `src/offline/offline.html?${params.toString()}`,
    );
    await chrome.tabs.create({ url });
}

async function load() {
    const params = new URLSearchParams(location.search);
    const resultId = Number(params.get("resultId"));
    const requestedFilter = params.get("filter");
    $("navigationFilter").value =
        requestedFilter === "same-domain-scan-type"
            ? "same-domain-scan-type"
            : "all";

    if (!Number.isInteger(resultId) || resultId <= 0) {
        status("Invalid saved record ID.");
        return;
    }

    try {
        status("Loading saved content...");

        const response = await chrome.runtime.sendMessage({
            type: "DB_GET_SAVED",
            resultId,
        });

        if (!response?.success) {
            throw new Error(response?.error || "Failed to load saved data.");
        }

        savedRow = response.result;

        if (!savedRow) {
            throw new Error(
                "Saved record was not found. It may have been deleted.",
            );
        }

        const data = parseData(savedRow);
        const config = parseConfig(savedRow);

        contentText = extractContent(data);
        jsonText = JSON.stringify(data, null, 2);

        $("title").textContent = savedRow.title || "(Untitled)";
        $("meta").textContent = [
            savedRow.domain || "Unknown domain",
            savedRow.url,
            config?.mode ? `Mode: ${config.mode}` : "Legacy scan",
            `Saved ${formatDate(savedRow.created_at)}`,
            `Result #${savedRow.result_id}`,
        ].join(" · ");

        renderConfiguredData(data, config);
        $("json").textContent = jsonText;
        $("contentCard").classList.remove("hidden");
        $("dataCard").classList.remove("hidden");
        $("openOriginal").disabled = false;

        await loadNavigation(resultId);

        status(
            config
                ? "Loaded from local SQLite. Fields are rendered using the saved scan configuration."
                : "Loaded from local SQLite. This is a legacy record without saved configuration.",
        );
    } catch (error) {
        status(error?.message || String(error));
    }
}

$("back").addEventListener("click", async () => {
    await chrome.tabs.create({
        url: chrome.runtime.getURL("src/manager/manager.html"),
    });
});

$("openOriginal").addEventListener("click", async () => {
    if (!savedRow?.url) return;
    await chrome.tabs.create({ url: savedRow.url });
});

$("previousPage").addEventListener("click", async () => {
    if (!navigation?.previous) return;
    await openOffline(navigation.previous.result_id, navigationFilterMode());
});

$("nextPage").addEventListener("click", async () => {
    if (!navigation?.next) return;
    await openOffline(navigation.next.result_id, navigationFilterMode());
});

$("navigationFilter").addEventListener("change", async () => {
    if (!savedRow?.result_id) return;
    try {
        status("Updating page navigation...");
        await loadNavigation(savedRow.result_id);
        status("");
    } catch (error) {
        status(error?.message || String(error));
    }
});

$("copyContent").addEventListener("click", () => {
    copyText(contentText, $("copyContent"), "Copied");
});

$("copyJson").addEventListener("click", () => {
    copyText(jsonText, $("copyJson"), "Copied");
});

load();
