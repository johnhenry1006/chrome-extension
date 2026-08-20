const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);
const storyId = Number(params.get("storyId"));
let story = null;
let pages = [];

function status(message) {
    $("status").textContent = message || "";
}
function escapeHtml(value) {
    return String(value ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
function formatDate(value) {
    return value ? new Date(Number(value)).toLocaleString() : "-";
}
function parseCategories(value) {
    try {
        const parsed = JSON.parse(value || "[]");
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return String(value || "")
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean);
    }
}
function progress() {
    const total = pages.length;
    const read = pages.filter((p) => Number(p.is_read) === 1).length;
    return { total, read, pct: total ? Math.round((read * 100) / total) : 0 };
}

async function api(type, payload = {}) {
    const response = await chrome.runtime.sendMessage({ type, ...payload });
    if (!response?.success)
        throw new Error(response?.error || "Request failed.");
    return response.result;
}

function render() {
    if (!story) return;
    const categories = parseCategories(story.categories_json);
    const p = progress();
    $("title").textContent = story.group_name || "Untitled Story";
    $("domain").textContent = story.domain || "";
    $("hero").innerHTML =
        `<div class="detail-cover">${story.cover_url ? `<img class="detail-cover" src="${escapeHtml(story.cover_url)}" alt="">` : "📖"}</div><div class="detail-copy"><h2>${escapeHtml(story.group_name || "Untitled Story")}</h2><p>${escapeHtml(story.description || "No description yet.")}</p><p><strong>Author:</strong> ${escapeHtml(story.author || "—")}</p><p><strong>Categories:</strong> ${categories.length ? categories.map(escapeHtml).join(", ") : "—"}</p><p><strong>Last saved:</strong> ${escapeHtml(formatDate(story.last_saved_at))}</p><div class="progress"><span style="width:${p.pct}%"></span></div></div>`;
    $("stats").innerHTML =
        `<div class="stat"><strong>${p.total}</strong><br>Pages</div><div class="stat"><strong>${p.read}</strong><br>Read</div><div class="stat"><strong>${p.pct}%</strong><br>Progress</div><div class="stat"><strong>${pages.filter((x) => Number(x.is_bookmarked) === 1).length}</strong><br>Bookmarks</div>`;
    $("pageSummary").textContent =
        `${p.total} pages · ${p.read} read · ${p.pct}% complete`;
    const firstUnread = pages.find((x) => Number(x.is_read) !== 1) || pages[0];
    $("resume").disabled = !firstUnread;
    $("resume").textContent = firstUnread
        ? p.read
            ? "Resume Reading"
            : "Start Reading"
        : "No Pages";
    const container = $("pages");
    container.replaceChildren();
    if (!pages.length) {
        container.innerHTML =
            '<div class="empty-chapters">No saved pages in this story.</div>';
        return;
    }
    for (const page of pages) {
        const item = document.createElement("article");
        item.className = `chapter ${Number(page.is_read) === 1 ? "read" : ""}`;
        item.innerHTML = `<div class="chapter-number">#${page.position}</div><div><div class="chapter-title">${escapeHtml(page.title || `Page ${page.position}`)}</div><div class="chapter-meta">Saved ${escapeHtml(formatDate(page.created_at))}</div></div><div class="chapter-actions"><button class="button secondary open-reader">Offline</button><button class="button secondary toggle-read">${Number(page.is_read) === 1 ? "Unread" : "Read"}</button><button class="button secondary bookmark">${Number(page.is_bookmarked) === 1 ? "★" : "☆"}</button></div>`;
        item.querySelector(".open-reader").addEventListener("click", () =>
            openReader(page.result_id),
        );
        item.querySelector(".toggle-read").addEventListener("click", () =>
            toggle(page, item),
        );
        item.querySelector(".bookmark").addEventListener("click", () =>
            bookmark(page, item),
        );
        container.appendChild(item);
    }
}

async function openReader(resultId) {
    // Keep the Story Detail tab. Offline Reader navigation itself also stays in one tab.
    location.href = chrome.runtime.getURL(
        `src/offline/offline.html?resultId=${Number(resultId)}&filter=same-domain-group`,
    );
}

async function toggle(page, item) {
    try {
        const next = Number(page.is_read) !== 1;
        const result = await api("DB_TOGGLE_READER_STATE", {
            resultId: page.result_id,
            isRead: next,
            isBookmarked: Number(page.is_bookmarked) === 1,
        });
        page.is_read = result.isRead ? 1 : 0;
        page.is_bookmarked = result.isBookmarked ? 1 : 0;
        render();
    } catch (e) {
        status(e?.message || String(e));
    }
}
async function bookmark(page) {
    try {
        const next = Number(page.is_bookmarked) !== 1;
        const result = await api("DB_TOGGLE_READER_STATE", {
            resultId: page.result_id,
            isRead: Number(page.is_read) === 1,
            isBookmarked: next,
        });
        page.is_read = result.isRead ? 1 : 0;
        page.is_bookmarked = result.isBookmarked ? 1 : 0;
        render();
    } catch (e) {
        status(e?.message || String(e));
    }
}

function openEditor() {
    $("editor").hidden = false;
    $("name").value = story.group_name || "";
    $("author").value = story.author || "";
    $("cover").value = story.cover_url || "";
    $("description").value = story.description || "";
    $("categories").value = parseCategories(story.categories_json).join(", ");
    $("editor").scrollIntoView({ behavior: "smooth", block: "start" });
}
$("edit").addEventListener("click", openEditor);
$("cancel").addEventListener("click", () => {
    $("editor").hidden = true;
});
$("save").addEventListener("click", async () => {
    try {
        const categories = $("categories")
            .value.split(",")
            .map((v) => v.trim())
            .filter(Boolean);
        await api("DB_UPDATE_STORY", {
            storyId,
            group_name: $("name").value.trim() || story.group_name,
            author: $("author").value.trim() || null,
            cover_url: $("cover").value.trim() || null,
            description: $("description").value.trim() || null,
            categories_json: JSON.stringify(categories),
        });
        $("editor").hidden = true;
        await load();
        status("Story metadata saved.");
    } catch (e) {
        status(e?.message || String(e));
    }
});
$("back").addEventListener("click", () => {
    location.href = chrome.runtime.getURL("src/stories/stories.html");
});
$("resume").addEventListener("click", () => {
    const page = pages.find((x) => Number(x.is_read) !== 1) || pages[0];
    if (page) openReader(page.result_id);
});

async function load() {
    try {
        if (!Number.isInteger(storyId) || storyId <= 0)
            throw new Error("Invalid story ID.");
        status("Loading story...");
        story = await api("DB_GET_STORY", { storyId });
        if (!story) throw new Error("Story not found.");
        pages = await api("DB_LIST_STORY_PAGES", { storyId });
        render();
        status("");
    } catch (e) {
        status(e?.message || String(e));
        $("title").textContent = "Story not found";
    }
}
load();
