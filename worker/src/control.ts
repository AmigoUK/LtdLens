/**
 * The kill switch.
 *
 * Twenty lines that let the owner answer a warning email from Companies House in
 * half a minute, without a store update and without a deployment:
 *
 *     echo '{"mode":"off","message":"Paused while we sort something out."}' \
 *       | wrangler kv key put --binding SNAPSHOTS control:v1 --env production
 *
 * The alternative, if Companies House ever objects to the traffic, is to publish
 * a new extension build and wait days for review while the objection stands. That
 * asymmetry is why this exists, and it is not in the original concept document.
 *
 * Cost: one KV read per request with `cacheTtl: 60`, which makes it colo-cached
 * and effectively free against the 100,000 reads a day the free plan allows. The
 * price of the switch is a minute's delay before it takes effect — worth paying,
 * because a per-request uncached read would be the single most expensive thing
 * in the Worker.
 */

export type ServiceMode = 'on' | 'off' | 'cache-only';

export interface ControlState {
  mode: ServiceMode;
  /** Shown to the user verbatim when paused. Keep it human. */
  message?: string;
  /** ISO timestamp after which the pause is ignored, if set. */
  until?: string;
}

const DEFAULT_STATE: ControlState = { mode: 'on' };

export async function readControl(kv: KVNamespace, now: Date): Promise<ControlState> {
  let stored: unknown;
  try {
    stored = await kv.get('control:v1', { type: 'json', cacheTtl: 60 });
  } catch {
    // A KV failure must not take the service down. Defaulting to "on" is the
    // right way to fail: the switch exists to stop traffic deliberately, not to
    // stop it by accident.
    return DEFAULT_STATE;
  }

  if (stored === null || typeof stored !== 'object') return DEFAULT_STATE;

  const candidate = stored as Partial<ControlState>;
  if (candidate.mode !== 'off' && candidate.mode !== 'cache-only') return DEFAULT_STATE;

  // An expiry that has passed means somebody set a pause and forgot about it.
  // Honouring it forever would be an outage nobody remembers causing.
  if (candidate.until !== undefined) {
    const until = Date.parse(candidate.until);
    if (!Number.isNaN(until) && now.getTime() >= until) return DEFAULT_STATE;
  }

  const state: ControlState = { mode: candidate.mode };
  if (typeof candidate.message === 'string' && candidate.message.trim().length > 0) {
    state.message = candidate.message.trim();
  }
  if (candidate.until !== undefined) state.until = candidate.until;
  return state;
}
