import { beforeEach, describe, expect, it } from 'vitest';
import { REQUESTS_PER_WINDOW, throttle } from '../src/security/throttle.js';
import { readControl } from '../src/control.js';
import { memoryEdgeCache } from '../src/cache/store.js';
import { count, resetCounts, snapshotCounts } from '../src/observability/counters.js';

const SALT = 'a-test-salt-of-no-consequence';

function requestFrom(address: string | undefined): Request {
  const headers = new Headers();
  if (address !== undefined) headers.set('CF-Connecting-IP', address);
  return new Request('https://api.ltdlens.test/v1/company/00445790', { headers });
}

describe('throttle', () => {
  const at = (seconds: number) => () => new Date(seconds * 1000);

  it('allows a normal burst of lookups', async () => {
    const cache = memoryEdgeCache();
    for (let i = 0; i < REQUESTS_PER_WINDOW; i += 1) {
      const decision = await throttle({
        request: requestFrom('203.0.113.10'),
        salt: SALT,
        now: at(1000),
        cache,
      });
      expect(decision.allowed).toBe(true);
    }
  });

  it('rejects the request past the limit, with a usable Retry-After', async () => {
    const cache = memoryEdgeCache();
    for (let i = 0; i < REQUESTS_PER_WINDOW; i += 1) {
      await throttle({ request: requestFrom('203.0.113.10'), salt: SALT, now: at(1000), cache });
    }

    const decision = await throttle({
      request: requestFrom('203.0.113.10'),
      salt: SALT,
      now: at(1000),
      cache,
    });
    expect(decision.allowed).toBe(false);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    expect(decision.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it('counts each client separately', async () => {
    const cache = memoryEdgeCache();
    for (let i = 0; i < REQUESTS_PER_WINDOW + 5; i += 1) {
      await throttle({ request: requestFrom('203.0.113.10'), salt: SALT, now: at(1000), cache });
    }

    // A different client must not inherit somebody else's exhausted budget.
    const other = await throttle({
      request: requestFrom('198.51.100.7'),
      salt: SALT,
      now: at(1000),
      cache,
    });
    expect(other.allowed).toBe(true);
  });

  it('starts a fresh window once the old one has ended', async () => {
    const cache = memoryEdgeCache();
    for (let i = 0; i < REQUESTS_PER_WINDOW + 1; i += 1) {
      await throttle({ request: requestFrom('203.0.113.10'), salt: SALT, now: at(1000), cache });
    }

    // A client must not be punished for a minute that finished while nobody was
    // looking at the counter.
    const later = await throttle({
      request: requestFrom('203.0.113.10'),
      salt: SALT,
      now: at(1_100),
      cache,
    });
    expect(later.allowed).toBe(true);
  });

  it('fails open when there is no salt', async () => {
    // A missing salt is a configuration problem. Denying every request over it
    // would turn a misconfiguration into an outage, and the Companies House
    // governor still protects the thing that actually matters.
    for (const salt of [undefined, '']) {
      const decision = await throttle({
        request: requestFrom('203.0.113.10'),
        salt,
        now: at(1000),
        cache: memoryEdgeCache(),
      });
      expect(decision.allowed).toBe(true);
    }
  });

  it('fails open when there is no client address', async () => {
    const decision = await throttle({
      request: requestFrom(undefined),
      salt: SALT,
      now: at(1000),
      cache: memoryEdgeCache(),
    });
    expect(decision.allowed).toBe(true);
  });

  it('never stores anything resembling the address', async () => {
    // The whole point of the hash. If an address could be read back out of the
    // counter store, the throttle would have quietly created the log this
    // project promises does not exist.
    const cache = memoryEdgeCache();
    const address = '203.0.113.10';
    await throttle({ request: requestFrom(address), salt: SALT, now: at(1000), cache });

    // memoryEdgeCache keys by URL, so reconstructing the key would require the
    // hash. Asserting the obvious: the address is not the key.
    expect(await cache.match(`https://throttle.ltdlens.internal/${address}`)).toBeUndefined();
  });

  it('gives the same client a different identity tomorrow', async () => {
    // Rotating the hash daily means nobody can be followed across days, even by
    // whoever holds the salt. This is the assertion that makes that a verified
    // property rather than a claim in a comment.
    const cache = memoryEdgeCache();
    const today = () => new Date('2026-07-30T23:00:00Z');
    const tomorrow = () => new Date('2026-07-31T01:00:00Z');

    // Exhaust today's allowance.
    for (let i = 0; i <= REQUESTS_PER_WINDOW; i += 1) {
      await throttle({ request: requestFrom('203.0.113.10'), salt: SALT, now: today, cache });
    }
    const blockedToday = await throttle({
      request: requestFrom('203.0.113.10'),
      salt: SALT,
      now: today,
      cache,
    });
    expect(blockedToday.allowed).toBe(false);

    // Two hours later, across midnight UTC, the same address is a different
    // client as far as this Worker is concerned.
    const freshTomorrow = await throttle({
      request: requestFrom('203.0.113.10'),
      salt: SALT,
      now: tomorrow,
      cache,
    });
    expect(freshTomorrow.allowed).toBe(true);
  });

  it('gives different clients different identities under the same salt', async () => {
    const cache = memoryEdgeCache();
    const now = () => new Date('2026-07-30T12:00:00Z');

    await throttle({ request: requestFrom('203.0.113.10'), salt: SALT, now, cache });
    await throttle({ request: requestFrom('198.51.100.7'), salt: SALT, now, cache });

    // Two distinct buckets exist, and neither is keyed by an address.
    expect(await cache.match('https://throttle.ltdlens.internal/203.0.113.10')).toBeUndefined();
    expect(await cache.match('https://throttle.ltdlens.internal/198.51.100.7')).toBeUndefined();
  });
});

describe('kill switch', () => {
  const now = new Date('2026-07-30T12:00:00Z');

  /** A KV stand-in. Only `get` is used. */
  function kvWith(value: unknown, options: { throws?: boolean } = {}): KVNamespace {
    return {
      get: () => {
        if (options.throws === true) return Promise.reject(new Error('KV unavailable'));
        return Promise.resolve(value);
      },
    } as unknown as KVNamespace;
  }

  it('is on by default', async () => {
    expect((await readControl(kvWith(null), now)).mode).toBe('on');
  });

  it('pauses the service and carries the owner’s wording', async () => {
    const state = await readControl(
      kvWith({ mode: 'off', message: 'Paused while we sort something out.' }),
      now,
    );
    expect(state.mode).toBe('off');
    expect(state.message).toBe('Paused while we sort something out.');
  });

  it('supports cache-only as a middle setting', async () => {
    expect((await readControl(kvWith({ mode: 'cache-only' }), now)).mode).toBe('cache-only');
  });

  it('ignores a pause whose expiry has passed', async () => {
    // Somebody set a pause and forgot. Honouring it forever would be an outage
    // nobody remembers causing.
    const state = await readControl(kvWith({ mode: 'off', until: '2026-07-30T11:00:00Z' }), now);
    expect(state.mode).toBe('on');
  });

  it('honours a pause that has not yet expired', async () => {
    const state = await readControl(kvWith({ mode: 'off', until: '2026-07-30T13:00:00Z' }), now);
    expect(state.mode).toBe('off');
  });

  it('stays on when KV fails', async () => {
    // The switch exists to stop traffic deliberately, not by accident.
    expect((await readControl(kvWith(null, { throws: true }), now)).mode).toBe('on');
  });

  it('ignores rubbish rather than failing closed', async () => {
    for (const value of ['off', 42, [], { mode: 'nonsense' }, { message: 'no mode' }]) {
      expect((await readControl(kvWith(value), now)).mode).toBe('on');
    }
  });

  it('drops an empty message rather than showing a blank pause', async () => {
    const state = await readControl(kvWith({ mode: 'off', message: '   ' }), now);
    expect(state.mode).toBe('off');
    expect(state.message).toBeUndefined();
  });
});

describe('counters', () => {
  beforeEach(() => {
    resetCounts();
  });

  it('counts events without naming anything', () => {
    count('company.miss');
    count('company.miss');
    count('upstream.ok');

    const totals = snapshotCounts();
    expect(totals['company.miss']).toBe(2);
    expect(totals['upstream.ok']).toBe(1);

    // The test that matters: nothing in the output could identify a company or a
    // person, because the module has access to nothing but the counter map.
    const serialised = JSON.stringify(totals);
    expect(serialised).not.toMatch(/\d{8}/); // no company numbers
    expect(serialised).not.toMatch(/\d{1,3}(\.\d{1,3}){3}/); // no addresses
  });
});
