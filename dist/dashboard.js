/**
 * Framework-free status widget for a ResilientSocket.
 * Returns a DOM element you can append anywhere (React/Vue/Svelte hosts can
 * mount it with a ref, or use the plain HTML demo).
 */
const COLORS = {
    connecting: "#9ca3af",
    open: "#22c55e",
    reconnecting: "#f59e0b",
    closed: "#ef4444",
};
const LABELS = {
    connecting: "Connecting",
    open: "Live",
    reconnecting: "Reconnecting",
    closed: "Stopped",
};
export function createStatusBadge(client) {
    const root = document.createElement("div");
    root.setAttribute("role", "status");
    root.setAttribute("aria-live", "polite");
    root.style.cssText =
        "display:inline-flex;align-items:center;gap:8px;font:14px/1.4 system-ui,sans-serif;" +
            "padding:6px 12px;border:1px solid rgba(0,0,0,.12);border-radius:999px;background:#fff;";
    const dot = document.createElement("span");
    dot.style.cssText = "width:10px;height:10px;border-radius:50%;display:inline-block;";
    const text = document.createElement("span");
    const meta = document.createElement("span");
    meta.style.cssText = "color:#6b7280;font-size:12px;";
    root.append(dot, text, meta);
    client.on("status", (snapshot) => {
        dot.style.background = COLORS[snapshot.state];
        text.textContent = LABELS[snapshot.state];
        const buffered = snapshot.buffered > 0 ? ` · ${snapshot.buffered} buffered` : "";
        meta.textContent = snapshot.attempt > 0 ? `attempt ${snapshot.attempt}${buffered}` : buffered.trim();
    });
    return root;
}
export function createFeedList(limit = 200) {
    const list = document.createElement("ul");
    list.style.cssText =
        "list-style:none;margin:0;padding:0;max-height:420px;overflow:auto;" +
            "font:13px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace;";
    return {
        element: list,
        push(message) {
            const item = document.createElement("li");
            item.style.cssText = "padding:4px 8px;border-bottom:1px solid #f1f5f9;";
            const stamp = new Date().toLocaleTimeString();
            const body = typeof message === "string" ? message : JSON.stringify(message);
            item.textContent = `${stamp}  ${body.slice(0, 300)}`;
            list.append(item);
            if (list.children.length > limit)
                list.firstElementChild?.remove();
        },
    };
}
