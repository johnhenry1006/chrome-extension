import { databaseRequest } from "./database-client.js";

export function buildScanTypeKey(config) {
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

export function normalizeGroupName(value) {
    return String(value ?? "")
        .replace(/\s+/g, " ")
        .trim();
}

export function buildGroupKey(value) {
    const name = normalizeGroupName(value);
    if (!name) return null;

    const ascii = name
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");

    if (ascii) return ascii;

    return name.toLowerCase();
}

export async function scanCurrentTab(config) {
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
    });

    if (!tab?.id) throw new Error("No active tab.");

    if (!/^https?:$/.test(new URL(tab.url || "").protocol)) {
        throw new Error("Only normal http/https pages can be scanned.");
    }

    let result;

    try {
        result = await chrome.tabs.sendMessage(tab.id, {
            type: "SCAN_PAGE",
            config,
        });
    } catch {
        await chrome.scripting.executeScript({
            target: { tabId: tab.id },
            files: ["src/content/content.js"],
        });

        result = await chrome.tabs.sendMessage(tab.id, {
            type: "SCAN_PAGE",
            config,
        });
    }

    if (!result?.success) {
        throw new Error(result?.error || "Scan failed.");
    }

    const groupName = normalizeGroupName(result.group?.name);
    const groupKey = buildGroupKey(groupName);

    const saved = await databaseRequest({
        action: "save_scan",
        page: result.page,
        data: result.data,
        config,
        scanTypeKey: buildScanTypeKey(config),
        groupName,
        groupKey,
    });

    return {
        ...result,
        group: groupName ? { name: groupName, key: groupKey } : null,
        saved: true,
        pageId: saved.pageId,
        resultId: saved.resultId,
    };
}
