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

    return false;
});
