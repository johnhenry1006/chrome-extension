import { databaseRequest } from "./sqlite-client.js";
chrome.runtime.onMessage.addListener((m, s, send) => {
    if (m?.target !== "web-scanner-offscreen" || m?.type !== "DB_REQUEST")
        return false;
    databaseRequest(m.request)
        .then((r) => send({ success: true, result: r }))
        .catch((e) => send({ success: false, error: e?.message || String(e) }));
    return true;
});
