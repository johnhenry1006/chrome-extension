const $ = (id) => document.getElementById(id);
let rows = [];
function escapeHtml(v) {
    return String(v ?? "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}
function date(v) {
    return v ? new Date(Number(v)).toLocaleString() : "-";
}
function pct(row) {
    const total = Number(row.page_count || 0),
        read = Number(row.read_count || 0);
    return total ? Math.min(100, Math.round((read * 100) / total)) : 0;
}
function status(v) {
    $("status").textContent = v || "";
}
async function load() {
    try {
        status("Loading stories...");
        const r = await chrome.runtime.sendMessage({
            type: "DB_LIST_STORIES",
            search: $("search").value.trim(),
            sort: $("sortBy").value,
            limit: 1000,
        });
        if (!r?.success) throw new Error(r?.error || "Failed to load stories.");
        rows = r.result || [];
        render();
        status("");
    } catch (e) {
        status(e?.message || String(e));
    }
}
function render() {
    const el = $("stories");
    el.replaceChildren();
    $("summary").textContent = `${rows.length} story/group(s)`;
    if (!rows.length) {
        el.innerHTML =
            '<div class="empty">No stories/groups found. Scan pages with a Group / Story configuration first.</div>';
        return;
    }
    for (const row of rows) {
        const card = document.createElement("article");
        card.className = "story-card";
        const progress = pct(row);
        card.innerHTML = `<div class="cover">${row.cover_url ? `<img src="${escapeHtml(row.cover_url)}" alt="">` : "📖"}</div><div class="story-body"><div class="story-name">${escapeHtml(row.group_name)}</div><div class="story-domain">${escapeHtml(row.domain)}</div><div class="story-description">${escapeHtml(row.description || "No description yet.")}</div><div class="stats"><span>${Number(row.page_count || 0)} pages</span><span>${Number(row.read_count || 0)} read</span><span>${Number(row.bookmark_count || 0)} bookmarks</span><span>Saved ${escapeHtml(date(row.last_saved_at))}</span></div><div class="progress"><span style="width:${progress}%"></span></div></div>`;
        card.addEventListener("click", () => {
            location.href = chrome.runtime.getURL(
                `src/stories/detail.html?storyId=${Number(row.story_id)}`,
            );
        });
        el.appendChild(card);
    }
}
$("search").addEventListener("input", load);
$("sortBy").addEventListener("change", load);
$("refresh").addEventListener("click", load);
load();
