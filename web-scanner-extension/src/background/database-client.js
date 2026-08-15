let creating = null;

const OFFSCREEN_URL = chrome.runtime.getURL("src/offscreen/offscreen.html");

async function exists() {
    if (!chrome.runtime.getContexts) return false;

    const contexts = await chrome.runtime.getContexts({
        contextTypes: ["OFFSCREEN_DOCUMENT"],
        documentUrls: [OFFSCREEN_URL],
    });

    return contexts.length > 0;
}

async function ensure() {
    if (!chrome.offscreen?.createDocument) {
        throw new Error(
            "Chrome Offscreen API is unavailable. Check Manifest V3, the offscreen permission, and reload the extension.",
        );
    }

    if (await exists()) return;
    if (creating) return creating;

    creating = chrome.offscreen
        .createDocument({
            url: "src/offscreen/offscreen.html",
            reasons: ["WORKERS"],
            justification:
                "Run SQLite WASM in a dedicated Worker for local scanner storage.",
        })
        .catch((error) => {
            if (
                !String(error?.message || error)
                    .toLowerCase()
                    .includes("already exists")
            ) {
                throw error;
            }
        })
        .finally(() => {
            creating = null;
        });

    return creating;
}

export async function databaseRequest(request) {
    await ensure();

    const response = await chrome.runtime.sendMessage({
        target: "web-scanner-offscreen",
        type: "DB_REQUEST",
        request,
    });

    if (!response?.success) {
        throw new Error(response?.error || "SQLite request failed");
    }

    return response.result;
}
