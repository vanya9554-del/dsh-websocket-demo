/**
 * Resilient WebSocket client: reconnect with jittered exponential backoff,
 * heartbeat-based stale detection, bounded message buffer, typed status events.
 *
 * No runtime dependencies. Uses the global WebSocket (browser or Node 18+).
 */
export type SocketState = "connecting" | "open" | "reconnecting" | "closed";
export interface StatusSnapshot {
    state: SocketState;
    attempt: number;
    nextRetryInMs: number | null;
    lastMessageAt: number | null;
    buffered: number;
}
export interface ResilientSocketOptions {
    /** Static URL, or a factory called on every connect attempt (use for expiring tokens). */
    url: string | (() => string);
    /** How often we expect the server to send something / how often we ping. */
    heartbeatIntervalMs?: number;
    /** No inbound frame for this long => treat the socket as stale and reconnect. */
    staleAfterMs?: number;
    /** Max messages kept while offline. */
    bufferSize?: number;
    backoff?: {
        baseMs?: number;
        maxMs?: number;
        jitter?: number;
    };
    /** Optional WebSocket constructor override (tests). */
    socketFactory?: (url: string) => WebSocketLike;
}
export interface WebSocketLike {
    readyState: number;
    send(data: string): void;
    close(): void;
    onopen: ((event: unknown) => void) | null;
    onclose: ((event: unknown) => void) | null;
    onerror: ((event: unknown) => void) | null;
    onmessage: ((event: {
        data: unknown;
    }) => void) | null;
}
type Handler<T> = (payload: T) => void;
export declare class ResilientSocket {
    private readonly options;
    private socket;
    private attempt;
    private retryTimer;
    private heartbeatTimer;
    private staleTimer;
    private buffer;
    private lastMessageAt;
    private stopped;
    private statusHandlers;
    private messageHandlers;
    private bufferedHandlers;
    constructor(options: ResilientSocketOptions);
    connect(): void;
    stop(): void;
    send(data: string): boolean;
    status(): StatusSnapshot;
    on(event: "status", handler: Handler<StatusSnapshot>): () => void;
    on(event: "message", handler: Handler<unknown>): () => void;
    on(event: "buffered", handler: Handler<unknown[]>): () => void;
    private url;
    private openSocket;
    private startHeartbeat;
    private scheduleRetry;
    private clearTimers;
    private emitStatus;
}
export {};
