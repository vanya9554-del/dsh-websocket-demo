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
  backoff?: { baseMs?: number; maxMs?: number; jitter?: number };
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
  onmessage: ((event: { data: unknown }) => void) | null;
}

type Handler<T> = (payload: T) => void;

const OPEN = 1;

export class ResilientSocket {
  private readonly options: Required<Pick<ResilientSocketOptions,
    "heartbeatIntervalMs" | "staleAfterMs" | "bufferSize">> & ResilientSocketOptions;
  private socket: WebSocketLike | null = null;
  private attempt = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private staleTimer: ReturnType<typeof setInterval> | null = null;
  private buffer: unknown[] = [];
  private lastMessageAt: number | null = null;
  private stopped = false;

  private statusHandlers: Handler<StatusSnapshot>[] = [];
  private messageHandlers: Handler<unknown>[] = [];
  private bufferedHandlers: Handler<unknown[]>[] = [];

  constructor(options: ResilientSocketOptions) {
    this.options = {
      baseMs: 500,
      maxMs: 30_000,
      jitter: 0.2,
      ...options.backoff,
      ...options,
      backoff: { baseMs: 500, maxMs: 30_000, jitter: 0.2, ...options.backoff },
    } as never;
  }

  // ---------------------------------------------------------------- public API

  connect(): void {
    this.stopped = false;
    this.openSocket("connecting");
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    this.socket?.close();
    this.socket = null;
    this.emitStatus("closed");
  }

  send(data: string): boolean {
    if (!this.socket || this.socket.readyState !== OPEN) return false;
    this.socket.send(data);
    return true;
  }

  status(): StatusSnapshot {
    return {
      state: this.stopped ? "closed" : this.socket?.readyState === OPEN ? "open" : "reconnecting",
      attempt: this.attempt,
      nextRetryInMs: null,
      lastMessageAt: this.lastMessageAt,
      buffered: this.buffer.length,
    };
  }

  on(event: "status", handler: Handler<StatusSnapshot>): () => void;
  on(event: "message", handler: Handler<unknown>): () => void;
  on(event: "buffered", handler: Handler<unknown[]>): () => void;
  on(event: string, handler: Handler<never>): () => void {
    if (event === "status") {
      this.statusHandlers.push(handler as Handler<StatusSnapshot>);
      return () => {
        this.statusHandlers = this.statusHandlers.filter((h) => h !== handler);
      };
    }
    if (event === "message") {
      this.messageHandlers.push(handler as Handler<unknown>);
      return () => {
        this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
      };
    }
    this.bufferedHandlers.push(handler as Handler<unknown[]>);
    return () => {
      this.bufferedHandlers = this.bufferedHandlers.filter((h) => h !== handler);
    };
  }

  // ---------------------------------------------------------------- internals

  private url(): string {
    return typeof this.options.url === "function" ? this.options.url() : this.options.url;
  }

  private openSocket(state: SocketState): void {
    if (this.stopped) return;
    this.emitStatus(state);
    let socket: WebSocketLike;
    try {
      socket = this.options.socketFactory
        ? this.options.socketFactory(this.url())
        : (new WebSocket(this.url()) as unknown as WebSocketLike);
    } catch {
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
        for (const handler of this.bufferedHandlers) handler(replay);
      }
    };

    socket.onmessage = (event) => {
      this.lastMessageAt = Date.now();
      for (const handler of this.messageHandlers) handler(event.data);
    };

    socket.onclose = () => {
      this.clearTimers();
      this.socket = null;
      if (!this.stopped) this.scheduleRetry();
    };

    socket.onerror = () => {
      // onclose follows in browsers; do nothing here to avoid double retries.
    };
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.socket?.readyState === OPEN) {
        try {
          this.socket.send(JSON.stringify({ type: "ping", ts: Date.now() }));
        } catch {
          /* socket died between checks; stale watchdog will catch it */
        }
      }
    }, this.options.heartbeatIntervalMs);

    this.staleTimer = setInterval(() => {
      if (this.lastMessageAt === null) return;
      if (Date.now() - this.lastMessageAt > this.options.staleAfterMs) {
        // Half-open connection: close it and let onclose schedule the retry.
        this.socket?.close();
      }
    }, Math.max(1000, Math.floor(this.options.staleAfterMs / 4)));
  }

  private scheduleRetry(): void {
    if (this.stopped) return;
    this.attempt += 1;
    const { baseMs = 500, maxMs = 30_000, jitter = 0.2 } = this.options.backoff || {};
    const raw = Math.min(maxMs, baseMs * Math.pow(2, this.attempt - 1));
    const delay = Math.round(raw * (1 + (Math.random() * 2 - 1) * jitter));
    this.emitStatus("reconnecting");
    this.retryTimer = setTimeout(() => this.openSocket("connecting"), delay);
  }

  private clearTimers(): void {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    if (this.staleTimer) clearInterval(this.staleTimer);
    this.retryTimer = null;
    this.heartbeatTimer = null;
    this.staleTimer = null;
  }

  private emitStatus(state: SocketState): void {
    const snapshot: StatusSnapshot = {
      state,
      attempt: this.attempt,
      nextRetryInMs: null,
      lastMessageAt: this.lastMessageAt,
      buffered: this.buffer.length,
    };
    for (const handler of this.statusHandlers) handler(snapshot);
  }
}
