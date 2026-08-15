(() => {
    if (window.__WEB_SCANNER_CONTENT_LOADED__) return;
    window.__WEB_SCANNER_CONTENT_LOADED__ = true;
    const clean = (s) =>
        s
            .replace(/\r\n?/g, "\n")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n[ \t]+/g, "\n")
            .replace(/[ \t]{2,}/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
    function textWithBreaks(el) {
        const c = el.cloneNode(true);
        c.querySelectorAll("br").forEach((x) => x.replaceWith("\n"));
        c.querySelectorAll("script,style,noscript").forEach((x) => x.remove());
        return clean(c.textContent || "");
    }
    function value(el, f) {
        if (!el) return null;
        switch (f.type || "text") {
            case "text":
                return clean(el.textContent || "");
            case "textWithBreaks":
                return textWithBreaks(el);
            case "html":
                return el.innerHTML;
            case "attribute":
                return el.getAttribute(f.attribute) ?? null;
            case "value":
                return "value" in el ? el.value : null;
            default:
                throw new Error("Unsupported field type: " + f.type);
        }
    }
    function fields(root, fs) {
        return Object.fromEntries(
            Object.entries(fs || {}).map(([n, f]) => {
                const scope = f.scope === "document" ? document : root;
                const el = f.selector ? scope.querySelector(f.selector) : root;
                return [n, value(el, f)];
            }),
        );
    }
    function scan(c) {
        if (!c?.mode || !c.selector)
            throw new Error("mode and selector are required");
        if (c.mode === "single") {
            const r = document.querySelector(c.selector);
            return r ? fields(r, c.fields) : null;
        }
        if (c.mode === "list")
            return [...document.querySelectorAll(c.selector)].map((r) =>
                fields(r, c.fields),
            );
        throw new Error("Unsupported mode: " + c.mode);
    }
    chrome.runtime.onMessage.addListener((m, s, send) => {
        if (m?.type !== "SCAN_PAGE") return false;
        try {
            send({
                success: true,
                page: {
                    url: location.href,
                    title: document.title,
                    domain: location.hostname,
                },
                data: scan(m.config),
            });
        } catch (e) {
            send({ success: false, error: e?.message || String(e) });
        }
        return true;
    });
})();
