# Database Guidelines

> D1 (SQLite) via `env.DB` binding, raw parameterized SQL, no ORM.
> Hard constraint driver: free tier allows **100k written rows/day** and every D1 statement counts as a **subrequest (50/invocation)**.

---

## Overview

- Single D1 database, binding `DB`, accessed only through `src/db/*.ts` modules (`settings.ts`, `sources.ts`, `models.ts`, `events.ts`). Routes/engine never inline SQL.
- All timestamps stored as **UTC ISO strings**. Display formatting (Beijing + UTC dual annotation) happens only in `src/lib/time.ts` / `src/notify/render.ts`.
- Business secrets (TG token, Resend key, recipients, admin password hash, feed secret) live in the `settings` k-v table — **never** in env vars, wrangler.toml, or GitHub secrets (spec:product/notifications.md).

## Query Patterns

- Every query parameterized (`?` placeholders, `.bind(...)`). No string interpolation into SQL, ever.
- Bulk writes use `db.batch([...preparedStmts])`; chunk at **≤100 bind params per statement** and ≤500 statements per batch (see `src/db/models.ts`, `src/db/settings.ts`).
- Read a source's full model set in **one** query (`SELECT model_id, missing, provider, snapshot FROM models WHERE source_id = ?`) and diff in memory — never loop per-model queries.

### Write-amplification rule (CRITICAL)

The `models` table has **no `last_seen` column by design**: stable rows are never written. A row is written only when its presence state changes (added / first-absence mark / delisted delete / recovery reset / rebaseline). Verified steady-state cost: ~288 rows/day at 4 sources × 48 runs.

- Steady run (body hash unchanged) per source: exactly **1 UPDATE** (`sources.last_success`) + 1 read-only SELECT (`findMissingModelIds`, to advance 2-strike delisted confirmation).
- Any change that adds a per-run write must re-justify against the 100k/day budget and the 50-subrequest cap.

## Migrations

- `migrations/0001_init.sql` — applied by CI via `wrangler d1 migrations apply --remote` (detection + `force_migrations` input, see `.github/workflows/deploy.yml`).
- New schema changes = new numbered migration files. Amending an already-deployed migration is forbidden; amending `0001` was only acceptable pre-first-deploy.
- Constraint changes require a table rebuild (SQLite cannot ALTER a constraint): `0004_notify_fail_events.sql` is the reference pattern — create-copy (explicit column lists on both sides, preserving `id`) → drop → rename → recreate indexes under their original names.
- Local dev: `npx wrangler d1 migrations apply <name> --local` (local state under `.wrangler/`, gitignored).

## Naming Conventions

- Tables plural snake_case (`settings`, `sources`, `models`, `events`); indexes `idx_<table>_<purpose>` (e.g. `idx_events_dedup`).
- Booleans stored as INTEGER 0/1. JSON payloads in TEXT columns named `snapshot`/`payload`/`v`.

## Common Mistakes

- **Don't** upsert the whole model list per run (quota killer — see write-amplification rule).
- **Don't** forget that `models` uses composite PK `(source_id, model_id)` with `WITHOUT ROWID`; `events.id` is the only AUTOINCREMENT.
- `events.source_name` is intentionally denormalized so `/feed` stays readable after a source is deleted.
- Dedup semantics live in `dedup_group` (`catalog` vs `channel:{source_id}`) — never dedup a channel source against anything. `notify:{channel}` marks system-level `notify_fail` events (`source_id=0`); it never participates in any dedup query.
