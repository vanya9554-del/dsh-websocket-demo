# Websocket dashboard with reconnect logic

A small, production-shaped TypeScript implementation of the piece buyers keep asking for:
a websocket feed that **does not silently die**. It reconnects with exponential backoff and
jitter, detects stale connections with a heartbeat, buffers messages while disconnected, and
exposes a tiny status model a dashboard can render.

Zero runtime dependencies. Works in the browser and in Node 18+ (uses the global `WebSocket`).

---

## What is inside

```
src/
  ws-client.ts   resilient client: connect, backoff, heartbeat, buffer, events
  dashboard.ts   framework-free status widget (works with React/Vue/vanilla)
  index.ts       demo entry point
test/
  ws-client.test.ts  tests with a fake socket implementation
```

## API

```ts
const client = new ResilientSocket({
  url: 'wss://example.com/feed',
  heartbeatIntervalMs: 15_000, // ping cadence
  staleAfterMs: 40_000,        // no message for this long => reconnect
  bufferSize: 500,             // remember this many messages while offline
  backoff: { baseMs: 500, maxMs: 30_000, jitter: 0.2 },
});

client.on('status', (status) => console.log(status.state)); // connecting | open | reconnecting | closed
client.on('message', (data) => render(data));
client.on('buffered', (messages) => replay(messages));
client.connect();
```

## Design decisions

1. **Status is a first-class event.** The UI never has to guess whether the feed is alive; it renders
   `client.status()` and the state machine drives the badge.
2. **Heartbeat + stale detection, not just `onclose`.** Half-open connections do not fire `onclose`.
   A message watchdog is the only reliable detector.
3. **Backoff with jitter.** `base * 2^n` capped at `maxMs`, multiplied by `1 ± jitter` so a fleet of
   clients does not thundering-herd the server after an outage.
4. **Buffer while offline.** Consumers get a replay event on reconnect; the buffer is bounded so a long
   outage cannot exhaust memory.
5. **No framework.** The dashboard component is a plain function returning a DOM node, so it drops into
   React, Vue, Svelte, or a plain page.

## Status model

| State | Meaning | UI |
|---|---|---|
| `connecting` | first attempt in flight | grey dot, "Connecting" |
| `open` | socket healthy, heartbeat recent | green dot, "Live" |
| `reconnecting` | disconnected, next attempt scheduled | amber dot, "Reconnecting in 3s" |
| `closed` | intentionally stopped | red dot, "Stopped" |

## Running the demo

```bash
npm install
npm run demo     # needs a websocket endpoint; set WS_URL
npm test
```

## Integration notes

- **Auth:** if the endpoint needs a token, pass it via a `urlFactory` so the *fresh* token is used on
  every reconnect (tokens expire and the whole point is long-lived sessions).
- **Message schema:** keep parsing in the consumer; the client passes through strings/ArrayBuffers.
- **Server side:** send a protocol-level ping every `heartbeatIntervalMs` and a pong on receipt; the
  client treats any inbound frame as liveness.
- **Backpressure:** if the consumer is slow, drop oldest buffered messages rather than growing memory.

## Tests

The test file uses a fake socket that can be told to fail, hang, or emit messages. Cases covered:

- reconnects with growing delay and jitter bounds;
- detects a stale connection via the heartbeat watchdog;
- buffers messages while offline and replays on reconnect;
- emits the correct status transitions;
- stops cleanly and does not schedule further attempts.
