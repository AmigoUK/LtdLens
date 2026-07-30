# LtdLens API

A caching proxy in front of the [Companies House public data API](https://developer.company-information.service.gov.uk/), and the only server component this project has. It exists for exactly one reason: **so users never need their own API key.** Every existing Companies House browser extension asks a non-technical business owner to register a developer account and paste a key, and that is where they lose their audience.

It returns normalised register **facts**. It never returns a verdict — no flags, no severity, no score. The ruleset runs in the browser.

## Running it without any credentials

```bash
npm run dev -w worker      # http://localhost:8787
```

`wrangler dev` defaults to local mode: workerd plus Miniflare, with KV simulated in `.wrangler/state`. **No Cloudflare account and no Companies House key are needed.** With no `CH_API_KEY`, the Worker replays recorded fixtures through the real normalisation, caching, coalescing and governor code, so everything downstream of the upstream seam is exercised exactly as it will be in production.

Every branch of the degradation ladder is reachable from `curl`:

```bash
curl localhost:8787/v1/health
curl localhost:8787/v1/company/00445790
curl 'localhost:8787/v1/search?q=tesco'

curl localhost:8787/v1/company/00445790 -H 'X-Fixture-Scenario: partial'    # optional sources fail
curl localhost:8787/v1/company/00445790 -H 'X-Fixture-Scenario: 429'        # rate limited
curl localhost:8787/v1/company/00445790 -H 'X-Fixture-Scenario: 500'        # register down
curl localhost:8787/v1/company/00445790 -H 'X-Fixture-Scenario: timeout'
curl localhost:8787/v1/company/99999999 -H 'X-Fixture-Scenario: not-found'
```

The scenario header is honoured only by the fixture upstream, and it cannot do anything in production because the fixture module is not in that bundle at all.

## Endpoints

| Endpoint                     | Returns                                                                               | Cache                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `GET /v1/company/{number}`   | Aggregated `CompanySnapshot` — profile, officer counts, charge counts, recent filings | 12 h fresh, 24 h stale-while-revalidate, 30 d emergency |
| `GET /v1/search?q=`          | Up to 20 candidates for disambiguation                                                | 1 h, **edge only**                                      |
| `GET /v1/rates/late-payment` | The statutory rate table                                                              | 7 days                                                  |
| `GET /v1/health`             | Environment, upstream mode, schema, ruleset version                                   | none                                                    |

`/v1/rates/late-payment` is **not** how the calculator gets its rates — the table ships inside the extension so the calculator makes no network request at all. This endpoint is only an update channel, so an old installation picks up a new half-year entry without waiting for a store release.

## What must never be logged

- **Nothing at all.** `no-console` is a lint error throughout `src/`, with one permitted observability module for aggregate counters. CI greps for violations.
- `observability.enabled` is `false` in **every** environment block of `wrangler.jsonc`. Wrangler env blocks inherit nothing and Cloudflare's default is on, so a missing block silently retains request URLs for three days. CI counts the blocks.
- `CF-Connecting-IP` may be read only by the throttle module, and only as a salted, daily-rotating, truncated hash. CI greps for reads elsewhere.
- No `logpush`, no tail consumers.

There is no request identifier in the error contract. There is no request log to correlate one with, and saying that is a stronger claim than promising not to log.

## The cache tiers

| Tier | Where                  | Holds                              |
| ---- | ---------------------- | ---------------------------------- |
| L0   | in-isolate promise map | in-flight requests, for coalescing |
| L1   | Cache API, per colo    | everything, including search       |
| L2   | Workers KV, global     | snapshots and rates **only**       |

**Search queries never reach KV.** That is a privacy decision before it is a cost one: a durable KV key containing what somebody typed would be a readable, enumerable record of it — the owner could run `wrangler kv key list` and read it. Edge entries are colo-local, not enumerable, and evict themselves. The edge key is a hash of the query even so, and the response body never echoes the query back, so a cached search response contains no user input at all.

Company snapshots are different in kind: keyed by a **public identifier**, containing **public register data**. They are not user data.

Freshness is judged from `fetchedAt` inside the payload, never from a cache expiry. That single field buys stale-while-revalidate, stale-if-error and an honest "as at" date for the interface — and it has to be hand-rolled anyway, because the Cache API does not support the `stale-while-revalidate` directive.

**KV is written on the second cold miss, not the first.** The free tier allows 1,000 writes a day, and that — not the request count — is the binding constraint. The "seen once" marker lives in the edge cache rather than KV, because a marker in KV would itself be a write and the policy would be strictly worse than no policy.

## The governor

One key, 600 requests per five minutes, shared by every user. A cold check costs four calls, so the ceiling is roughly 150 cold checks per five minutes for the whole user base. Sharding across keys is forbidden — Companies House may ban an application that appears to work around the limit — so the defences are behavioural.

| Remaining | State        | Behaviour                                                  |
| --------- | ------------ | ---------------------------------------------------------- |
| ≥ 150     | normal       | Full fan-out                                               |
| 50–149    | brownout     | Optional sources dropped; snapshot returns `partial: true` |
| < 50      | lockout      | Cache only; a cold miss gets 503 and a `Retry-After`       |
| —         | hard lockout | After a 429, until the window resets. **Never retried.**   |

Degrading **depth** before **availability** matters: in brownout a report still arrives, honestly marked incomplete, and the flag engine already knows how to say "not checked" rather than "clear".

The budget tracker is isolate-scoped, so a 429 locks out one isolate for the window. State deliberately does not live in KV — a write per rate-limit observation would spend the entire free write budget on telemetry about the budget.

## The kill switch

If Companies House ever objects to the traffic, the alternative to this would be
publishing a new extension build and waiting days for review while the objection
stands. Instead:

```bash
echo '{"mode":"off","message":"Paused while we sort something out."}' \
  | wrangler kv key put --binding SNAPSHOTS control:v1 --env production

# Optionally auto-expiring, so a forgotten pause is not a permanent outage:
echo '{"mode":"off","until":"2026-08-01T09:00:00Z"}' \
  | wrangler kv key put --binding SNAPSHOTS control:v1 --env production

# Resume:
wrangler kv key delete --binding SNAPSHOTS control:v1 --env production
```

Takes effect within a minute — reads use `cacheTtl: 60`, which is what makes the
switch effectively free against the read budget. `/v1/health` and
`/v1/rates/late-payment` stay reachable while paused: the first so you can
confirm the pause took effect, the second so the interest calculator keeps
working. The paused message is shown to users verbatim.

It fails towards "on". A KV error, a malformed value or an expiry that has passed
all resolve to the service running, because the switch is for stopping traffic
deliberately rather than by accident.

## Throttling

40 requests per client per minute, sized so a bookkeeper running fifty checks in
an afternoon never notices while a script in a loop does.

The client identifier is a **truncated HMAC over a secret salt plus the current
UTC date**. The address is never stored, never logged, and never a key on its own,
so the value is not reversible and it rotates at midnight — nobody can be followed
across days even by whoever holds the salt. Reading `CF-Connecting-IP` anywhere
outside `src/security/throttle.ts` is a lint error, and CI greps for it as well,
because a lint rule can be disabled inline.

Counters live in the Cache API rather than KV: a rate-limit counter in KV would be
one write per request, which is the whole free write budget spent defending the
free write budget. Cache entries are colo-local, so a determined client could get
one bucket per colo. That is accepted — the point is to stop a runaway script, and
the Companies House governor is the real backstop.

Throttling fails open when the salt is missing. A missing salt is a configuration
problem, and denying every request over it would turn a misconfiguration into an
outage.

## Deploying

Everything up to here works with no account. Deployment does not — see `docs/CREDENTIALS_SETUP.md`. In outline:

```bash
wrangler kv namespace create SNAPSHOTS --env production
wrangler secret put CH_API_KEY --env production
wrangler versions upload --env production
wrangler versions deploy --env production      # rollback is then one command
curl https://api.ltdlens.uk/v1/health          # confirm upstream reports "live"
```

`parseEnv` refuses to boot a production Worker without a key, so a deployment cannot quietly serve fixture data. Check `/v1/health` anyway — it is the one thing worth confirming after every deploy.

The custom domain is load-bearing rather than cosmetic: the Cache API is documented not to function on `workers.dev`, which would remove the L1 tier and roughly triple KV write pressure.

## Regenerating types

```bash
npm run cf-typegen -w worker
```

`worker-configuration.d.ts` is generated and committed, so a fresh clone typechecks without running Wrangler first. Regenerate after any change to `wrangler.jsonc`.
