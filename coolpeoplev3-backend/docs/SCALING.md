# Horizontal-scaling readiness

This platform is built for real, concurrent usership. The request layer is
**stateless** (Express + JWT auth via `findUserByToken`, no in-memory sessions)
and talks to Postgres through a connection **pool**, so it *can* run as N
instances behind a load balancer.

This doc tracks the things that must be true before you run **more than one
instance**. Everything here is correct on a single instance today — these are
multi-instance concerns only.

---

## ✅ Done (no infra needed)

- **DB concurrency correctness.** `server/DB/index.js` is a `pg.Pool`; every
  request borrows its own connection. Multi-statement work uses
  `withTransaction(tx)`; read-modify-write races use `SELECT … FOR UPDATE`.
  (See `memory: project_db_pool_transactions`.)
- **Scheduled jobs are single-leader.** `server/jobs/scheduledJobs.js` gates each
  cron run behind a Postgres **advisory lock** (`pg_try_advisory_xact_lock`).
  Every instance starts the schedule, but only the lock winner runs the job; the
  rest skip. No duplicate/triple side effects. No Redis required.
- **Pool size is tunable per instance.** `DB_POOL_MAX` env var (defaults to 10).

---

## ⬜ TODO — do BEFORE the 2nd instance

### 1. Rate limiter → shared store (Redis/Upstash)
- **Where:** `server/middleware/index.js` → `rateLimit()` (the `_buckets` Map).
- **Problem:** counts live in a per-process `Map`. With N instances each box
  counts separately, so a user's real limit becomes ~N× and inconsistent
  (depends which instance the LB routed them to).
- **Fix:** back the counter with Redis (Upstash is already in the intended
  stack). Fixed-window via `INCR` + `EXPIRE`, or a sliding-window script. Keep
  the same `(type, ip, route)` key shape and the `rate_limit_violations` write.
- **Why deferred:** needs the Redis service provisioned; the in-memory version is
  *correct* for one instance, so there's nothing to meaningfully finish in code
  until that service exists.

### 2. DB connection pooler → PgBouncer (or provider pooled endpoint)
- **Problem:** each instance holds its own pool (`DB_POOL_MAX`, default 10).
  `instances × DB_POOL_MAX` must stay under Postgres `max_connections` (~100 by
  default). At a handful of instances you hit the ceiling and new connections
  start failing.
- **Fix:** put **PgBouncer** (transaction pooling mode) in front of Postgres, or
  use your managed provider's pooled connection string, and point
  `DATABASE_URL` at it. Then per-instance `DB_POOL_MAX` can stay small.
- **Caveat:** transaction-pooling mode disallows session-level features
  (session `SET`, plain `LISTEN/NOTIFY`, session advisory locks). We already use
  **transaction-scoped** advisory locks (`pg_try_advisory_xact_lock`) and
  `withTransaction`, so we're compatible — keep it that way.
- **Why deferred:** deploy-time infra, not application code.

---

## Pre-2nd-instance checklist
- [ ] Rate limiter moved to Redis (#1)
- [ ] PgBouncer / pooled endpoint in front of Postgres; `DATABASE_URL` updated (#2)
- [ ] `DB_POOL_MAX` set so `instances × DB_POOL_MAX` < Postgres `max_connections`
- [ ] Confirm scheduled jobs run exactly once across the fleet (advisory lock — already done)
- [ ] Load balancer terminates TLS and sets `X-Forwarded-*` (app already trusts proxy)
