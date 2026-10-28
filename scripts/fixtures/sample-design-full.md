<!-- EGM test fixture: intentionally flawed sample design document -->

# Design: Rate Limiter Service

## The Problem

API traffic from our largest tenants now peaks above what the shared pool can
absorb. When one tenant runs a badly configured batch job, every other tenant
on the same shard sees elevated latency. The only protection today is a coarse
per-IP throttle at the edge, which does not map to business tiers: a premium
tenant behind a large NAT gateway shares a budget with free-tier traffic from
the same network. Operations cannot raise or lower a limit without a deploy.
We need per-tenant, per-route rate limiting that is enforced before a request
reaches business logic, with limits that can change in seconds through an API.

## Overview

We will add a rate limiter service: a small stateful service that answers one
question per request — "should this request be allowed right now?" — using a
token bucket per (tenant, route, user) key. Edge proxies ask the limiter once
per request and reject with 429 when the answer is negative. A decision costs
one counter increment and one comparison, so the limiter stays fast even at
peak load. An admin API allows operations to adjust limits per tenant and per
route; changes take effect on the next request without a deploy.

Every decision is logged with its key, the remaining budget, and the outcome,
so support can answer "why was this customer throttled?" from a single query.

## Goals

- Enforce per-tenant, per-route, per-user limits at the edge before business
  logic runs.
- Support at least 50,000 limit decisions per second per node with p99
  decision latency under 5 ms.
- Let operations change any limit through the admin API and have the change
  take effect within one second, without restarting anything.
- Return clear 429 responses that name the exhausted bucket and the time when
  the next request will be allowed.

## Non-Goals

- Billing or metering: the limiter counts requests for enforcement only.
- Global exact accounting across regions; each region enforces its own
  budget. Cross-region fairness is explicitly out of scope for v1.
- A self-service dashboard for tenants; limits are managed by operations.
- Rate limiting of internal service-to-service traffic.

## Proposed Architecture

The service is a small cluster of stateful limiter nodes behind the existing
edge proxies. Each node holds the token buckets for the keys it decides on and
answers decision requests from its local memory.

### Decision path

1. The edge proxy extracts the key (tenant, route, user) and calls the
   limiter's `Decide` endpoint.
2. The node refills the bucket for that key from elapsed time, then tries to
   take one token.
3. The node returns allow or deny, the remaining budget, and the retry-after
   interval. The proxy enforces the answer.

### Counters

Each limiter node keeps its buckets in a local in-process map keyed by
(tenant, route, user). Entries are never evicted; a bucket that goes unused
simply stays at its refill ceiling. On boot every map starts empty. Counter
deltas are broadcast on the DKL stream so that all nodes in a region converge
on the same counts within a few milliseconds, which keeps the cluster
consistent enough for enforcement without a synchronous write per request.

### Policy plugboard

Bucket behavior sits behind a `RateLimitStrategy` interface, and a
`StrategyRegistry` loads strategy modules at runtime by name. Token bucket is
the first strategy; because the plugboard is configuration-driven, future
algorithms — leaky bucket, sliding-window log, or adaptive limits derived
from traffic models — can be added later as drop-in modules with no code
changes to the decision path. The registry also lets each tenant pin a
different strategy per route from the admin API on day one.

### Admin API

A small REST surface on each node supports listing, reading, and updating
limits. Updates are written to the shared config store; nodes watch that
store and reload limits within one second.

## Detailed Implementation Plan

The service lives in a new `src/ratelimit/` tree inside the edge repository.

### File changes

- `src/ratelimit/config.ts` — parse and validate the limit configuration
  (tenant and route defaults, per-route overrides, strategy selection).
  Fail closed on invalid config at startup and refuse partial updates.
- `src/ratelimit/counter.ts` — the in-process bucket map: refill, take,
  delta computation, and the publish/subscribe hooks that attach to the DKL
  stream. This module owns the convergence behavior described above.
- `src/ratelimit/middleware.ts` — edge middleware that builds the decision
  key and enforces the answer. Tenant identification reuses the existing
  `parseAuthHeader(request: Request): string` helper from
  `extensions/lib/auth.ts`; route identification uses the matched route id
  already attached to the request by the router.
- `src/ratelimit/server.ts` — the decision endpoint and the admin API,
  including request validation and the config-store watcher that reloads
  limits within one second of a change.
- `src/ratelimit/dkl_client.ts` — subscribe to counter deltas, apply remote
  deltas to the local map, and publish local deltas with coalescing so a
  hot key does not flood the stream.

### Test plan

- `config.ts`: valid and invalid configuration files, override precedence,
  fail-closed behavior on malformed input.
- `middleware.ts`: key construction for anonymous and authenticated
  requests, allow and deny paths, 429 payload shape, retry-after header.
- `server.ts`: decision endpoint contract, admin API CRUD paths, and
  config reload timing.

## Alternatives Considered

- Centralized counters in Redis: exact global accounting with one network
  round trip per request. Rejected for the decision path because it adds
  1-2 ms p99 at the edge and couples enforcement to a new stateful
  dependency; we would rather converge asynchronously. Redis remains an
  option for the admin API's audit log if we later need exact counts.
- Adopting an existing global rate limit proxy: rejected because its
  configuration model cannot express per-user buckets inside a tenant tier,
  and it would move enforcement off our own edge proxies.
- Keeping the per-IP edge throttle and adding per-tenant quotas offline:
  rejected because it does not stop the noisy-neighbor problem in real time,
  which is the trigger for this work.

The local-map design trades exactness for latency: during the few
milliseconds before deltas converge, two nodes may disagree on a bucket by a
small margin. We accept that margin for enforcement purposes.
