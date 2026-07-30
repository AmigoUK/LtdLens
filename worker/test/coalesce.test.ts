/**
 * Coalescing, tested directly rather than through `SELF.fetch`.
 *
 * The first version of this went through the HTTP surface: fire three concurrent
 * requests for one cold company and assert they share a timestamp. It passed,
 * then failed, then passed — `SELF.fetch` gives no guarantee that concurrent
 * requests share an isolate, so the module-scoped promise map may or may not be
 * the same one. A test that is right two runs in three is worse than no test,
 * because a real regression hides in the noise.
 *
 * So the unit is tested deterministically here, with a counter that cannot lie
 * about how many times the work actually ran, and the HTTP tests stick to
 * asserting the cache behaviour they can actually observe.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import { coalesce, inFlightCount, resetCoalescing } from '../src/cache/coalesce.js';

beforeEach(() => {
  resetCoalescing();
});

/** A promise with an externally-controlled resolution, so timing is exact. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('coalesce', () => {
  it('runs the work once for concurrent callers on the same key', async () => {
    const gate = deferred<string>();
    let runs = 0;

    const work = () => {
      runs += 1;
      return gate.promise;
    };

    const all = Promise.all([coalesce('k', work), coalesce('k', work), coalesce('k', work)]);
    expect(runs).toBe(1);
    expect(inFlightCount()).toBe(1);

    gate.resolve('value');
    expect(await all).toEqual(['value', 'value', 'value']);
    expect(runs).toBe(1);
  });

  it('keeps different keys independent', async () => {
    let runs = 0;
    const work = () => {
      runs += 1;
      return Promise.resolve(runs);
    };

    await Promise.all([coalesce('a', work), coalesce('b', work)]);
    expect(runs).toBe(2);
  });

  it('releases the key once the work settles, so the next caller gets fresh data', async () => {
    let runs = 0;
    const work = () => {
      runs += 1;
      return Promise.resolve(runs);
    };

    expect(await coalesce('k', work)).toBe(1);
    expect(inFlightCount()).toBe(0);
    expect(await coalesce('k', work)).toBe(2);
  });

  it('does not poison the key when the work rejects', async () => {
    // This is the bug everyone writes first: leaving a rejected promise in the
    // map serves the same failure to every subsequent caller for the lifetime of
    // the isolate. One upstream blip would become a permanent outage for that
    // company, in that colo, with no way to clear it.
    let runs = 0;

    await expect(
      coalesce('k', () => {
        runs += 1;
        return Promise.reject(new Error('upstream blip'));
      }),
    ).rejects.toThrow('upstream blip');

    expect(inFlightCount()).toBe(0);

    expect(
      await coalesce('k', () => {
        runs += 1;
        return Promise.resolve('recovered');
      }),
    ).toBe('recovered');
    expect(runs).toBe(2);
  });

  it('propagates a rejection to every concurrent caller', async () => {
    const gate = deferred<string>();
    const work = () => gate.promise;

    const first = coalesce('k', work);
    const second = coalesce('k', work);

    gate.reject(new Error('failed'));

    await expect(first).rejects.toThrow('failed');
    await expect(second).rejects.toThrow('failed');
    expect(inFlightCount()).toBe(0);
  });
});
