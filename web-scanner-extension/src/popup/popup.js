const $ = (id) => document.getElementById(id);

let last = null;

function config() {
    let fields;

    try {
        fields = JSON.parse($("fields").value);
    } catch {
        throw new Error("Fields JSON is invalid.");
    }

    return {
        name: $("name").value.trim() || "Untitled",
        mode: $("mode").value,
        selector: $("selector").value.trim(),
        fields,
    };
}

function status(message) {
    $("status").textContent = message;
}

function output(value) {
    $("output").textContent = JSON.stringify(value, null, 2);
}

$("scan").onclick = async () => {
    try {
        $("scan").disabled = true;
        status("Scanning and saving to SQLite...");

        const response = await chrome.runtime.sendMessage({
            type: "SCAN_CURRENT_TAB",
            config: config(),
        });

        if (!response?.success) {
            throw new Error(response?.error || "Scan failed.");
        }

        last = response;
        output(response);

        const count = Array.isArray(response.data)
            ? response.data.length
            : response.data
              ? 1
              : 0;

        status(
            `Scan complete and saved. ${count} result(s). ` +
                `pageId=${response.pageId}, resultId=${response.resultId}`,
        );
    } catch (error) {
        status(error?.message || String(error));
    } finally {
        $("scan").disabled = false;
    }
};

$("ping").onclick = async () => {
    try {
        status("Testing SQLite...");

        const response = await chrome.runtime.sendMessage({
            type: "DB_PING",
        });

        if (!response?.success) {
            throw new Error(response?.error || "SQLite test failed.");
        }

        output(response.result);
        status("SQLite WASM + OPFS is ready.");
    } catch (error) {
        status(error?.message || String(error));
    }
};

$("manageSaved").onclick = async () => {
    await chrome.tabs.create({
        url: chrome.runtime.getURL("src/manager/manager.html"),
    });
};

$("viewSaved").onclick = async () => {
    try {
        status("Loading saved data...");

        const response = await chrome.runtime.sendMessage({
            type: "DB_LIST_SAVED",
            limit: 50,
        });

        if (!response?.success) {
            throw new Error(response?.error || "Failed to load saved data.");
        }

        const rows = response.result.map((row) => ({
            ...row,
            data: JSON.parse(row.data_json),
        }));

        output(rows);
        status(`${rows.length} saved scan result(s).`);
    } catch (error) {
        status(error?.message || String(error));
    }
};

$("copyResult").onclick = async () => {
    if (!last) {
        status("Nothing to copy yet.");
        return;
    }

    await navigator.clipboard.writeText(JSON.stringify(last.data, null, 2));

    status("Result copied.");
};

$("copyConfig").onclick = async () => {
    try {
        await navigator.clipboard.writeText(JSON.stringify(config(), null, 2));

        status("Configuration copied.");
    } catch (error) {
        status(error?.message || String(error));
    }
};
