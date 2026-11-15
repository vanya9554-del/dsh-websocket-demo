/**
 * Resilient WebSocket client: reconnect with jittered exponential backoff,
 * heartbeat-based stale detection, bounded message buffer, typed status events.
 *
 * No runtime dependencies. Uses the global WebSocket (browser or Node 18+).
 */
const OPEN = 1;
export class ResilientSocket {
    options;
    socket = null;
    attempt = 0;
    retryTimer = null;
    heartbeatTimer = null;
    staleTimer = null;
    buffer = [];
    lastMessageAt = null;
    stopped = false;
    statusHandlers = [];
    messageHandlers = [];
    bufferedHandlers = [];
    constructor(options) {
        this.options = {
            baseMs: 500,
            maxMs: 30_000,
            jitter: 0.2,
            ...options.backoff,
            ...options,
            backoff: { baseMs: 500, maxMs: 30_000, jitter: 0.2, ...options.backoff },
        };
    }
    // ---------------------------------------------------------------- public API
    connect() {
        this.stopped = false;
        this.openSocket("connecting");
    }
    stop() {
        this.stopped = true;
        this.clearTimers();
        this.socket?.close();
        this.socket = null;
        this.emitStatus("closed");
    }
    send(data) {
        if (!this.socket || this.socket.readyState !== OPEN)
            return false;
        this.socket.send(data);
        return true;
    }
    status() {
        return {
            state: this.stopped ? "closed" : this.socket?.readyState === OPEN ? "open" : "reconnecting",
            attempt: this.attempt,
            nextRetryInMs: null,
            lastMessageAt: this.lastMessageAt,
            buffered: this.buffer.length,
        };
    }
    on(event, handler) {
        if (event === "status") {
            this.statusHandlers.push(handler);
            return () => {
                this.statusHandlers = this.statusHandlers.filter((h) => h !== handler);
            };
        }
        if (event === "message") {
            this.messageHandlers.push(handler);
            return () => {
                this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
            };
        }
        this.bufferedHandlers.push(handler);
        return () => {
            this.bufferedHandlers = this.bufferedHandlers.filter((h) => h !== handler);
        };
    }
    // ---------------------------------------------------------------- internals
    url() {
        return typeof this.options.url === "function" ? this.options.url() : this.options.url;
    }
    openSocket(state) {
        if (this.stopped)
            return;
        this.emitStatus(state);
        let socket;
        try {
            socket = this.options.socketFactory
                ? this.options.socketFactory(this.url())
                : new WebSocket(this.url());
        }
        catch {
            this.scheduleRetry();
            return;
        }
        this.socket = socket;
        socket.onopen = () => {
            this.attempt = 0;
            this.lastMessageAt = Date.now();
            this.emitStatus("open");
            this.startHeartbeat();
            if (this.buffer.length > 0) {
                const replay = this.buffer.splice(0, this.buffer.length);
                for (const handler of this.bufferedHandlers)
                    handler(replay);
            }
        };
        socket.onmessage = (event) => {
            this.lastMessageAt = Date.now();
            for (const handler of this.messageHandlers)
                handler(event.data);
        };
        socket.onclose = () => {
            this.clearTimers();
            this.socket = null;
            if (!this.stopped)
                this.scheduleRetry();
        };
        socket.onerror = () => {
            // onclose follows in browsers; do nothing here to avoid double retries.
        };
    }
    startHeartbeat() {
        this.heartbeatTimer = setInterval(() => {
            if (this.socket?.readyState === OPEN) {
                try {
                    this.socket.send(JSON.stringify({ type: "ping", ts: Date.now() }));
                }
                catch {
                    /* socket died between checks; stale watchdog will catch it */
                }
            }
        }, this.options.heartbeatIntervalMs);
        this.staleTimer = setInterval(() => {
            if (this.lastMessageAt === null)
                return;
            if (Date.now() - this.lastMessageAt > this.options.staleAfterMs) {
                // Half-open connection: close it and let onclose schedule the retry.
                this.socket?.close();
            }
        }, Math.max(1000, Math.floor(this.options.staleAfterMs / 4)));
    }
    scheduleRetry() {
        if (this.stopped)
            return;
        this.attempt += 1;
        const { baseMs = 500, maxMs = 30_000, jitter = 0.2 } = this.options.backoff || {};
        const raw = Math.min(maxMs, baseMs * Math.pow(2, this.attempt - 1));
        const delay = Math.round(raw * (1 + (Math.random() * 2 - 1) * jitter));
        this.emitStatus("reconnecting");
        this.retryTimer = setTimeout(() => this.openSocket("connecting"), delay);
    }
    clearTimers() {
        if (this.retryTimer)
            clearTimeout(this.retryTimer);
        if (this.heartbeatTimer)
            clearInterval(this.heartbeatTimer);
        if (this.staleTimer)
            clearInterval(this.staleTimer);
        this.retryTimer = null;
        this.heartbeatTimer = null;
        this.staleTimer = null;
    }
    emitStatus(state) {
        const snapshot = {
            state,
            attempt: this.attempt,
            nextRetryInMs: null,
            lastMessageAt: this.lastMessageAt,
            buffered: this.buffer.length,
        };
        for (const handler of this.statusHandlers)
            handler(snapshot);
    }
}
