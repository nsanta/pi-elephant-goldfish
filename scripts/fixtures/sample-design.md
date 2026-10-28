<!-- EGM test fixture: intentionally flawed sample design document -->

# Design: Webhook Delivery Service

## Summary

We will build an outbound webhook delivery service so customer integrations can
react to platform events in near real time. Producers publish events to an
internal bus; the delivery service drains them and POSTs signed payloads to
subscriber endpoints.

## Motivation

Today, customers poll our REST API for changes. Polling wastes quota and
delays integrations by minutes. A push-based webhook service removes both
problems and unblocks three named enterprise accounts.

## Architecture

- Producers emit domain events to the internal message bus.
- The dispatcher consumes events and writes each one to the RQ for delivery.
- A pool of delivery workers pops batches from the RQ and POSTs the payload.
- Delivery state is tracked in the existing `webhook_subscriptions` table.

Producers need no changes: the bus already carries every event type we plan to
support in v1.

## Delivery guarantees

Every payload is signed with HMAC-SHA256 using the subscription secret. Each
delivery attempt sets a 10 second timeout. The service runs in a single region
for v1; multi-region failover is included so that a regional outage cannot
interrupt deliveries. Failover relies on a warm standby stack that mirrors the
dispatcher and worker pools in a second region, with a health probe that
flips DNS when the primary stops answering.

## Event fan-out

When an event arrives, the dispatcher expands it once per matching
subscription and enqueues one delivery item per subscriber. Ordering follows
the arrival order in the bus. Items carry the subscription id, the event id,
and the endpoint URL. Retries are scheduled with exponential backoff.

## Security

Payloads are signed; subscribers verify the signature header. Subscription
secrets are generated at subscription creation time and shown once to the
customer. Endpoint URLs must use HTTPS.

## Observability

We add a dashboard with delivery success rate, queue depth, and p95 delivery
latency. Worker logs include the event id and subscription id on every line.

## Rollout

The service ships behind a feature flag per workspace. We enable it for the
three enterprise accounts first, then generally. The new `webhook-fetch`
client wraps the whole POST path with signing, timeouts, and backoff so that
delivery logic stays independent of the generic HTTP stack used elsewhere.
