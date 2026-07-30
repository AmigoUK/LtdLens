/**
 * Typed messaging between the surfaces and the background worker.
 *
 * The `return true` discipline in `onRequest` is the part that matters. A message
 * listener that answers asynchronously **must** return `true` synchronously, or
 * Chrome closes the channel and the caller's promise never settles — with no error
 * anywhere. It presents as a panel that loads forever.
 */

import type { BgBroadcast, BgRequest } from '../lib/types.js';

/** Sends a request to the background worker and waits for its reply. */
export async function sendToBackground<T>(message: BgRequest): Promise<T> {
  return await chrome.runtime.sendMessage<BgRequest, T>(message);
}

type Handler = (message: BgRequest) => Promise<unknown>;

/** Registers the background worker's single request handler. */
export function onRequest(handler: Handler): void {
  chrome.runtime.onMessage.addListener(
    (message: unknown, _sender, sendResponse: (response: unknown) => void) => {
      if (typeof message !== 'object' || message === null || !('type' in message)) return;

      handler(message as BgRequest)
        .then(sendResponse)
        .catch((cause: unknown) => {
          // Answer even on failure. Leaving the channel open would hang the
          // caller with no diagnostic at all.
          sendResponse({
            state: 'error',
            kind: 'upstream',
            message: cause instanceof Error ? cause.message : 'Unexpected error',
          });
        });

      // Keeps the channel open for the async reply. Removing this breaks every
      // surface at once, silently.
      return true;
    },
  );
}

/**
 * Broadcasts to whichever surfaces are listening.
 *
 * Failure is expected and ignored: with no panel or popup open there is no
 * receiver, and Chrome rejects. That is not an error worth surfacing.
 */
export function broadcast(message: BgBroadcast): void {
  void chrome.runtime.sendMessage(message).catch(() => undefined);
}

/** Subscribes a surface to background broadcasts. */
export function onBroadcast(handler: (message: BgBroadcast) => void): () => void {
  const listener = (message: unknown): void => {
    if (typeof message === 'object' && message !== null && 'type' in message) {
      const type = (message as { type: string }).type;
      if (type.startsWith('panel/')) handler(message as BgBroadcast);
    }
  };

  chrome.runtime.onMessage.addListener(listener);
  return () => {
    chrome.runtime.onMessage.removeListener(listener);
  };
}
