/**
 * Framework-free status widget for a ResilientSocket.
 * Returns a DOM element you can append anywhere (React/Vue/Svelte hosts can
 * mount it with a ref, or use the plain HTML demo).
 */
import type { ResilientSocket } from "./ws-client";
export declare function createStatusBadge(client: ResilientSocket): HTMLElement;
export declare function createFeedList(limit?: number): {
    element: HTMLElement;
    push: (message: unknown) => void;
};
