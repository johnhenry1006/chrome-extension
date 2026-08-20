const $ = (id) => document.getElementById(id);

let last = null;
let lastAppliedSample = null;

const FIELD_SAMPLES = {
    single: {
        content: {
            type: "html",
        },
    },
    list: {
        title: {
            selector: ".title",
            type: "text",
        },
        content: {
            selector: ".content",
            type: "html",
        },
    },
};

function sampleJson(mode) {
    const sample = FIELD_SAMPLES[mode] || FIELD_SAMPLES.single;
    return JSON.stringify(sample, null, 2);
}

function normalizeJson(value) {
    try {
        return JSON.stringify(JSON.parse(value));
    } catch {
        return null;
    }
}

function isFieldsCustomized() {
    const current = normalizeJson($("fields").value);

    if (current === null) {
        return true;
    }

    return current !== lastAppliedSample;
}

function updateFieldsState() {
    const customized = isFieldsCustomized();
    $("resetFields").hidden = !customized;
    $("fieldsHint").textContent = customized
        ? "Custom fields preserved. Reset to use the mode sample."
        : "Uses the sample for the selected mode.";

    $("fieldsHint").classList.toggle("customized", customized);
}

function setFieldsSample(mode) {
    $("fields").value = sampleJson(mode);
    lastAppliedSample = normalizeJson($("fields").value);
    updateFieldsState();
}

function updateGroupUI() {
    const type = $("groupType").value;
    const isSelector = type === "selector";
    const isMeta = type === "meta";

    $("groupSelectorRow").classList.toggle("hidden", !(isSelector || isMeta));
    $("groupAttributeRow").classList.toggle("hidden", !isSelector);
    $("groupPatternRow").classList.toggle("hidden", type !== "url-pattern");
    $("groupValueRow").classList.toggle("hidden", type !== "constant");
    $("groupFieldRow").classList.toggle("hidden", type !== "field");

    if (isMeta) {
        $("groupSelectorLabel").textContent = "Meta selector";
        $("groupSelector").placeholder = 'meta[property="og:title"]';
    } else {
        $("groupSelectorLabel").textContent = "Story name selector";
        $("groupSelector").placeholder = ".story-title";
    }
}

function groupConfig() {
    const type = $("groupType").value;
    if (type === "none") return { enabled: false, type: "none" };

    if (type === "selector") {
        return {
            enabled: true,
            type,
            selector: $("groupSelector").value.trim(),
            attribute: $("groupAttribute").value.trim(),
        };
    }

    if (type === "meta") {
        return {
            enabled: true,
            type,
            selector: $("groupSelector").value.trim(),
        };
    }

    if (type === "url-pattern") {
        return {
            enabled: true,
            type,
            pattern: $("groupPattern").value.trim(),
        };
    }

    if (type === "field") {
        return {
            enabled: true,
            type,
            field: $("groupField").value.trim(),
        };
    }

    return {
        enabled: true,
        type,
        value: $("groupValue").value.trim(),
    };
}

function config() {
    let fields;

    try {
        fields = JSON.parse($("fields").value);
    } catch {
        throw new Error("Fields JSON is invalid.");
    }

    const group = groupConfig();
    if (group.type === "selector" || group.type === "meta") {
        if (!group.selector) throw new Error("Group selector is required.");
    }
    if (group.type === "url-pattern") {
        if (!group.pattern) throw new Error("Group URL pattern is required.");
        try {
            new RegExp(group.pattern);
        } catch {
            throw new Error("Group URL pattern is invalid.");
        }
    }
    if (group.type === "constant" && !group.value) {
        throw new Error("Group value is required.");
    }
    if (group.type === "field" && !group.field) {
        throw new Error("Extracted field name is required.");
    }

    return {
        name: $("name").value.trim() || "Untitled",
        mode: $("mode").value,
        selector: $("selector").value.trim(),
        group: groupConfig(),
        fields,
    };
}

function status(message) {
    $("status").textContent = message;
}

function output(value) {
    $("output").textContent = JSON.stringify(value, null, 2);
}

$("groupType").addEventListener("change", updateGroupUI);

$("mode").addEventListener("change", () => {
    const mode = $("mode").value;

    if (isFieldsCustomized()) {
        updateFieldsState();
        status(
            `Mode changed to ${mode === "single" ? "Single" : "List"}. ` +
                "Your custom Fields JSON was preserved.",
        );
        return;
    }

    setFieldsSample(mode);
    status(
        `Mode changed to ${mode === "single" ? "Single" : "List"}. ` +
            "Fields JSON sample updated.",
    );
});

$("fields").addEventListener("input", () => {
    updateFieldsState();
});

$("resetFields").addEventListener("click", () => {
    const mode = $("mode").value;
    setFieldsSample(mode);
    status(
        `Fields JSON reset to the ${mode === "single" ? "Single" : "List"} sample.`,
    );
});

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

$("manageStories").onclick = async () => {
    await chrome.tabs.create({
        url: chrome.runtime.getURL("src/stories/stories.html"),
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

lastAppliedSample = normalizeJson($("fields").value);
updateFieldsState();
updateGroupUI();
