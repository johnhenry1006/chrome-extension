const $ = (id) => document.getElementById(id);

let rows = [];
let filteredRows = [];

function status(message) {
    $("status").textContent = message || "";
}

function formatDate(value) {
    if (!value) return "-";
    return new Date(Number(value)).toLocaleString();
}

function parseData(row) {
    try {
        return JSON.parse(row.data_json);
    } catch {
        return null;
    }
}

function parseConfig(row) {
    try {
        return JSON.parse(row.config_json);
    } catch {
        return null;
    }
}

function scanTypeLabel(row) {
    const config = parseConfig(row);
    if (!config) return "Legacy";
    const mode = config.mode || "single";
    const selector = config.selector ? ` · ${config.selector}` : "";
    return `${mode}${selector}`;
}

function previewData(row) {
    const data = parseData(row);
    if (!data) return row.data_json || "";

    if (typeof data === "string") return data;

    const content = data.content;
    if (typeof content === "string") return content;

    return JSON.stringify(data);
}

function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function compareText(a, b) {
    return String(a || "").localeCompare(String(b || ""), undefined, {
        numeric: true,
        sensitivity: "base",
    });
}

function sortRows(items) {
    const sortBy = $("sortBy").value;
    const result = [...items];

    result.sort((a, b) => {
        switch (sortBy) {
            case "created-asc":
                return (
                    Number(a.created_at || 0) - Number(b.created_at || 0) ||
                    Number(a.result_id || 0) - Number(b.result_id || 0)
                );
            case "title-asc":
                return (
                    compareText(a.title, b.title) ||
                    Number(b.created_at || 0) - Number(a.created_at || 0)
                );
            case "title-desc":
                return (
                    compareText(b.title, a.title) ||
                    Number(b.created_at || 0) - Number(a.created_at || 0)
                );
            case "domain-asc":
                return (
                    compareText(a.domain, b.domain) ||
                    compareText(a.title, b.title) ||
                    Number(b.created_at || 0) - Number(a.created_at || 0)
                );
            case "domain-desc":
                return (
                    compareText(b.domain, a.domain) ||
                    compareText(a.title, b.title) ||
                    Number(b.created_at || 0) - Number(a.created_at || 0)
                );
            case "group-asc":
                return (
                    compareText(a.group_name, b.group_name) ||
                    compareText(a.domain, b.domain) ||
                    compareText(a.title, b.title)
                );
            case "group-desc":
                return (
                    compareText(b.group_name, a.group_name) ||
                    compareText(a.domain, b.domain) ||
                    compareText(a.title, b.title)
                );
            case "created-desc":
            default:
                return (
                    Number(b.created_at || 0) - Number(a.created_at || 0) ||
                    Number(b.result_id || 0) - Number(a.result_id || 0)
                );
        }
    });

    return result;
}

function groupByDomain(items) {
    const groups = new Map();

    for (const row of items) {
        const domain = row.domain || "Unknown domain";
        if (!groups.has(domain)) groups.set(domain, []);
        groups.get(domain).push(row);
    }

    return [...groups.entries()];
}

function updateSelectionState() {
    const selected = document.querySelectorAll(
        ".record-checkbox:checked",
    ).length;

    $("deleteSelected").disabled = selected === 0;
    $("deleteSelected").textContent = selected
        ? `Delete Selected (${selected})`
        : "Delete Selected";

    document.querySelectorAll(".group-select").forEach((checkbox) => {
        const group = checkbox.closest(".group");
        const boxes = [...group.querySelectorAll(".record-checkbox")];
        checkbox.checked =
            boxes.length > 0 && boxes.every((box) => box.checked);
        checkbox.indeterminate =
            boxes.some((box) => box.checked) && !checkbox.checked;
    });
}

function render() {
    const container = $("groups");
    container.innerHTML = "";

    $("summary").textContent =
        `${filteredRows.length} of ${rows.length} saved record(s)`;

    if (!filteredRows.length) {
        container.innerHTML = '<div class="empty">No saved data found.</div>';
        updateSelectionState();
        return;
    }

    for (const [domain, domainRows] of groupByDomain(filteredRows)) {
        const group = document.createElement("section");
        group.className = "group";

        group.innerHTML = `
      <div class="group-header">
        <div>
          <span class="group-title">${escapeHtml(domain)}</span>
          <span class="group-count">${domainRows.length} record(s)</span>
        </div>
        <div class="group-actions">
          <label class="group-select-label">
            <input type="checkbox" class="group-select" />
            Select all
          </label>
        </div>
      </div>
    `;

        for (const row of domainRows) {
            const preview = previewData(row).slice(0, 500);
            const record = document.createElement("article");
            record.className = "record";
            record.innerHTML = `
        <input
          type="checkbox"
          class="record-checkbox"
          data-id="${Number(row.result_id)}"
          aria-label="Select saved record"
        />
        <div class="record-main">
          <div class="record-title">${escapeHtml(row.title || "(Untitled)")}</div>
          <div class="record-url">${escapeHtml(row.url)}</div>
          <div class="record-meta">Saved: ${escapeHtml(formatDate(row.created_at))} · Result #${Number(row.result_id)} · Type: ${escapeHtml(scanTypeLabel(row))}</div>
          <div class="record-group">${row.group_name ? `Story / group: <strong>${escapeHtml(row.group_name)}</strong>` : "Story / group: —"}</div>
          <div class="record-preview">${escapeHtml(preview)}</div>
        </div>
        <div class="record-actions">
          <button class="button small secondary open-button" data-url="${escapeHtml(row.url)}">Open</button>
          <button class="button small secondary offline-button">Offline</button>
        </div>
      `;

            record
                .querySelector(".record-checkbox")
                .addEventListener("change", updateSelectionState);
            record
                .querySelector(".open-button")
                .addEventListener("click", () => openUrl(row.url));
            record
                .querySelector(".offline-button")
                .addEventListener("click", () => openOffline(row.result_id));
            group.appendChild(record);
        }

        const groupSelect = group.querySelector(".group-select");
        groupSelect.addEventListener("change", () => {
            group.querySelectorAll(".record-checkbox").forEach((checkbox) => {
                checkbox.checked = groupSelect.checked;
            });
            updateSelectionState();
        });

        container.appendChild(group);
    }

    updateSelectionState();
}

async function load() {
    try {
        status("Loading saved data...");

        const response = await chrome.runtime.sendMessage({
            type: "DB_LIST_SAVED",
            limit: 1000,
        });

        if (!response?.success) {
            throw new Error(response?.error || "Failed to load saved data.");
        }

        rows = response.result || [];
        applySearch();
        status("");
    } catch (error) {
        status(error?.message || String(error));
    }
}

function applySearch() {
    const query = $("search").value.trim().toLowerCase();

    if (!query) {
        filteredRows = [...rows];
    } else {
        filteredRows = rows.filter((row) => {
            return [row.domain, row.title, row.url].some((value) =>
                String(value || "")
                    .toLowerCase()
                    .includes(query),
            );
        });
    }

    filteredRows = sortRows(filteredRows);
    render();
}

async function openUrl(url) {
    try {
        const response = await chrome.runtime.sendMessage({
            type: "OPEN_SAVED_URL",
            url,
        });

        if (!response?.success) {
            throw new Error(response?.error || "Failed to open page.");
        }
    } catch (error) {
        status(error?.message || String(error));
    }
}

async function openOffline(resultId) {
    try {
        const response = await chrome.runtime.sendMessage({
            type: "OPEN_SAVED_OFFLINE",
            resultId,
        });

        if (!response?.success) {
            throw new Error(response?.error || "Failed to open offline view.");
        }
    } catch (error) {
        status(error?.message || String(error));
    }
}

async function deleteSelected() {
    const ids = [...document.querySelectorAll(".record-checkbox:checked")]
        .map((checkbox) => Number(checkbox.dataset.id))
        .filter(Number.isInteger);

    if (!ids.length) return;

    const confirmed = window.confirm(
        `Delete ${ids.length} selected record(s)? This action cannot be undone.`,
    );

    if (!confirmed) return;

    try {
        $("deleteSelected").disabled = true;
        status("Deleting selected records...");

        const response = await chrome.runtime.sendMessage({
            type: "DB_DELETE_SAVED",
            resultIds: ids,
        });

        if (!response?.success) {
            throw new Error(response?.error || "Delete failed.");
        }

        status(
            `Deleted ${response.result.deletedCount} record(s) and ` +
                `${response.result.deletedPageCount} orphan page(s).`,
        );

        await load();
    } catch (error) {
        status(error?.message || String(error));
        updateSelectionState();
    }
}

$("refresh").addEventListener("click", load);
$("search").addEventListener("input", applySearch);
$("sortBy").addEventListener("change", applySearch);
$("deleteSelected").addEventListener("click", deleteSelected);

load();
