const $ = (id) => document.getElementById(id);

let savedRow = null;
let contentText = "";
let jsonText = "";

function status(message) {
    $("status").textContent = message || "";
}

function parseData(row) {
    try {
        return JSON.parse(row.data_json);
    } catch {
        return row.data_json || null;
    }
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

async function load() {
    const resultId = Number(
        new URLSearchParams(location.search).get("resultId"),
    );

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
        contentText = extractContent(data);
        jsonText = JSON.stringify(data, null, 2);

        $("title").textContent = savedRow.title || "(Untitled)";
        $("meta").textContent = [
            savedRow.domain || "Unknown domain",
            savedRow.url,
            `Saved ${formatDate(savedRow.created_at)}`,
            `Result #${savedRow.result_id}`,
        ].join(" · ");

        $("content").textContent =
            contentText || "(No content field found in this scan result.)";
        $("json").textContent = jsonText;
        $("contentCard").classList.remove("hidden");
        $("dataCard").classList.remove("hidden");
        $("openOriginal").disabled = false;
        status("Loaded from local SQLite.");
    } catch (error) {
        status(error?.message || String(error));
    }
}

$("back").addEventListener("click", () => {
    chrome.tabs.create({
        url: chrome.runtime.getURL("src/manager/manager.html"),
    });
});

$("openOriginal").addEventListener("click", async () => {
    if (!savedRow?.url) return;
    await chrome.tabs.create({ url: savedRow.url });
});

$("copyContent").addEventListener("click", () => {
    copyText(contentText, $("copyContent"), "Copied");
});

$("copyJson").addEventListener("click", () => {
    copyText(jsonText, $("copyJson"), "Copied");
});

load();
