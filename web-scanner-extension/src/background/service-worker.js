import { scanCurrentTab } from "./scan-manager.js";
import { databaseRequest } from "./database-client.js";

chrome.runtime.onInstalled.addListener(() => {
    console.log("Web Data Scanner installed");
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === "SCAN_CURRENT_TAB") {
        scanCurrentTab(message.config)
            .then((result) => sendResponse(result))
            .catch((error) =>
                sendResponse({
                    success: false,
                    error: error?.message || String(error),
                }),
            );

        return true;
    }

    if (message?.type === "DB_PING") {
        databaseRequest({ action: "ping" })
            .then((result) => sendResponse({ success: true, result }))
            .catch((error) =>
                sendResponse({
                    success: false,
                    error: error?.message || String(error),
                }),
            );

        return true;
    }

    if (message?.type === "DB_GET_SAVED") {
        databaseRequest({
            action: "get_saved",
            resultId: message.resultId,
        })
            .then((result) => sendResponse({ success: true, result }))
            .catch((error) =>
                sendResponse({
                    success: false,
                    error: error?.message || String(error),
                }),
            );

        return true;
    }

    if (message?.type === "DB_LIST_SAVED") {
        databaseRequest({
            action: "list_saved",
            limit: message.limit,
        })
            .then((result) => sendResponse({ success: true, result }))
            .catch((error) =>
                sendResponse({
                    success: false,
                    error: error?.message || String(error),
                }),
            );

        return true;
    }

    if (message?.type === "DB_GET_SAVED_NAVIGATION") {
        databaseRequest({
            action: "get_saved_navigation",
            resultId: message.resultId,
        })
            .then((result) => sendResponse({ success: true, result }))
            .catch((error) =>
                sendResponse({
                    success: false,
                    error: error?.message || String(error),
                }),
            );

        return true;
    }

    if (message?.type === "DB_DELETE_SAVED") {
        databaseRequest({
            action: "delete_saved",
            resultIds: message.resultIds,
        })
            .then((result) => sendResponse({ success: true, result }))
            .catch((error) =>
                sendResponse({
                    success: false,
                    error: error?.message || String(error),
                }),
            );

        return true;
    }

    if (message?.type === "OPEN_SAVED_URL") {
        chrome.tabs
            .create({ url: message.url })
            .then((tab) => sendResponse({ success: true, tabId: tab.id }))
            .catch((error) =>
                sendResponse({
                    success: false,
                    error: error?.message || String(error),
                }),
            );

        return true;
    }

    if (message?.type === "OPEN_SAVED_OFFLINE") {
        const resultId = Number(message.resultId);

        if (!Number.isInteger(resultId) || resultId <= 0) {
            sendResponse({ success: false, error: "Invalid saved record ID." });
            return false;
        }

        const url = chrome.runtime.getURL(
            `src/offline/offline.html?resultId=${resultId}`,
        );

        chrome.tabs
            .create({ url })
            .then((tab) => sendResponse({ success: true, tabId: tab.id }))
            .catch((error) =>
                sendResponse({
                    success: false,
                    error: error?.message || String(error),
                }),
            );

        return true;
    }

    return false;
});
