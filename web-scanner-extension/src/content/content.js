(() => {
    if (window.__WEB_SCANNER_CONTENT_LOADED__) return;
    window.__WEB_SCANNER_CONTENT_LOADED__ = true;

    const clean = (value) =>
        String(value || "")
            .replace(/\r\n?/g, "\n")
            .replace(/[ \t]+\n/g, "\n")
            .replace(/\n[ \t]+/g, "\n")
            .replace(/[ \t]{2,}/g, " ")
            .replace(/\n{3,}/g, "\n\n")
            .trim();

    function textWithBreaks(element) {
        const clone = element.cloneNode(true);
        clone.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
        clone
            .querySelectorAll("script,style,noscript")
            .forEach((node) => node.remove());
        return clean(clone.textContent || "");
    }

    function value(element, field) {
        if (!element) return null;

        switch (field.type || "text") {
            case "text":
                return clean(element.textContent || "");
            case "textWithBreaks":
                return textWithBreaks(element);
            case "html":
                return element.innerHTML;
            case "attribute":
                return element.getAttribute(field.attribute) ?? null;
            case "value":
                return "value" in element ? element.value : null;
            default:
                throw new Error(`Unsupported field type: ${field.type}`);
        }
    }

    function fields(root, fieldConfig) {
        return Object.fromEntries(
            Object.entries(fieldConfig || {}).map(([name, field]) => {
                const scope = field.scope === "document" ? document : root;
                const element = field.selector
                    ? scope.querySelector(field.selector)
                    : root;
                return [name, value(element, field)];
            }),
        );
    }

    function scan(config) {
        if (!config?.mode || !config.selector) {
            throw new Error("mode and selector are required");
        }

        if (config.mode === "single") {
            const root = document.querySelector(config.selector);
            return root ? fields(root, config.fields) : null;
        }

        if (config.mode === "list") {
            return [...document.querySelectorAll(config.selector)].map((root) =>
                fields(root, config.fields),
            );
        }

        throw new Error(`Unsupported mode: ${config.mode}`);
    }

    function groupValue(config, data) {
        const group = config?.group;
        if (
            !group ||
            group.enabled === false ||
            !group.type ||
            group.type === "none"
        ) {
            return null;
        }

        switch (group.type) {
            case "selector": {
                const element = document.querySelector(group.selector || "");
                if (!element) return null;
                return group.attribute
                    ? element.getAttribute(group.attribute)
                    : element.textContent;
            }

            case "meta": {
                const element = document.querySelector(group.selector || "");
                if (!element) return null;
                return element.getAttribute("content") || element.textContent;
            }

            case "url-pattern": {
                if (!group.pattern) return null;
                const regex = new RegExp(group.pattern);
                const match = location.href.match(regex);
                return match?.[1] || match?.[0] || null;
            }

            case "constant":
                return group.value || null;

            case "field": {
                const fieldName = group.field;
                if (!fieldName) return null;
                const source = Array.isArray(data) ? data[0] : data;
                return source && typeof source === "object"
                    ? source[fieldName]
                    : null;
            }

            default:
                throw new Error(`Unsupported group type: ${group.type}`);
        }
    }

    chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
        if (message?.type !== "SCAN_PAGE") return false;

        try {
            const data = scan(message.config);
            const group = groupValue(message.config, data);
            sendResponse({
                success: true,
                page: {
                    url: location.href,
                    title: document.title,
                    domain: location.hostname,
                },
                group: group ? { name: clean(group) } : null,
                data,
            });
        } catch (error) {
            sendResponse({
                success: false,
                error: error?.message || String(error),
            });
        }

        return true;
    });
})();
