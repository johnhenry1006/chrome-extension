let worker = null;
let nextId = 0;
let workerReady = null;
const pending = new Map();

function createWorker() {
    const workerUrl = chrome.runtime.getURL("src/db-worker/sqlite-worker.js");
    const wasmUrl = chrome.runtime.getURL("sqlite3.wasm");
    const instance = new Worker(workerUrl, { type: "module" });

    let resolveReady;
    let rejectReady;

    workerReady = new Promise((resolve, reject) => {
        resolveReady = resolve;
        rejectReady = reject;
    });

    const readyTimeout = setTimeout(() => {
        rejectReady(new Error("SQLite worker initialization timed out."));
    }, 15000);

    instance.onmessage = (event) => {
        const message = event.data || {};

        if (message.type === "READY") {
            clearTimeout(readyTimeout);
            resolveReady();
            return;
        }

        if (message.type === "INIT_ERROR") {
            clearTimeout(readyTimeout);
            rejectReady(
                new Error(
                    message.error || "SQLite worker initialization failed.",
                ),
            );
            return;
        }

        const { id, success, result, error } = message;
        const promise = pending.get(id);

        if (!promise) return;

        pending.delete(id);

        if (success) {
            promise.resolve(result);
        } else {
            promise.reject(new Error(error || "SQLite worker failed"));
        }
    };

    instance.onerror = (event) => {
        clearTimeout(readyTimeout);
        rejectReady(new Error(event.message || "SQLite worker crashed"));

        const error = new Error(event.message || "SQLite worker crashed");
        for (const promise of pending.values()) {
            promise.reject(error);
        }

        pending.clear();
        worker = null;
        workerReady = null;
    };

    instance.postMessage({
        type: "INIT",
        wasmUrl,
    });

    return instance;
}

async function getWorker() {
    if (!worker) {
        worker = createWorker();
    }

    try {
        await workerReady;
    } catch (error) {
        worker?.terminate();
        worker = null;
        workerReady = null;
        throw error;
    }

    return worker;
}

export async function databaseRequest(request) {
    const id = ++nextId;
    const instance = await getWorker();

    return new Promise((resolve, reject) => {
        pending.set(id, { resolve, reject });
        instance.postMessage({ id, request });
    });
}
