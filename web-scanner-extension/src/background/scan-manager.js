import { databaseRequest } from "./database-client.js";

export async function scanCurrentTab(config) {
    const [tab] = await chrome.tabs.query({
        active: true,
        currentWindow: true,
    });

    if (!tab?.id) {
        throw new Error("No active tab.");
    }

    if (!/^https?:$/.test(new URL(tab.url || "").protocol)) {
        throw new Error("Only normal http/https pages can be scanned.");
    }

    let result;

    try {
        result = await chrome.tabs.sendMessage(tab.id, {
            type: "SCAN_PAGE",
            config,
        });
    } catch (error) {
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

    // Persist the page and its scan result as one database operation.
    const saved = await databaseRequest({
        action: "save_scan",
        page: result.page,
        data: result.data,
        config,
    });

    return {
        ...result,
        saved: true,
        pageId: saved.pageId,
        resultId: saved.resultId,
    };
}
