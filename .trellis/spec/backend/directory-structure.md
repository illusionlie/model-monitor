# Directory Structure

> Single Cloudflare Worker (TypeScript, ESM), Hono router, D1-only storage.

---

## Overview

One deployable unit. Everything runs in the same Worker: cron poller, notification dispatcher, admin UI, feed endpoint. No separate frontend app — admin pages are server-rendered HTML strings from `src/admin/ui/` (inline CSS + vanilla JS, no build step).

---

## Directory Layout

```
src/
├── index.ts          # entry: export default { fetch, scheduled } — wiring only, no logic
├── app.ts            # Hono assembly: mounts admin/feed routes
├── env.ts            # Env type — DB + SEND_EMAIL bindings ONLY (business secrets are D1 data)
├── lib/              # pure utilities, no I/O deps: cron, time (Beijing/UTC + weekly gate), lock, crypto, headers
├── db/               # D1 access layer, one file per table; only place SQL lives
├── poll/             # engine.ts (runOnce orchestrator, buildFetchHeaders), normalize.ts (3 source shapes), diff.ts (pure state machine)
├── notify/           # render.ts (message templates, single owner), telegram.ts, email.ts, dispatch.ts (channel matrix), weekly.ts
└── admin/            # auth.ts (PBKDF2 + cookie), routes.ts, ui/ (css / page + theme, setup, login, admin tabs+dialog, index re-export)
migrations/           # numbered SQL migrations
scripts/cron-expr.mjs # CLI wrapper over src/lib/cron.ts (imports .ts directly, node ≥23.6 type stripping)
test/                 # vitest, pure-logic + stubbed D1; may use node APIs (src/ may not)
```

---

## Module Organization

- Layering: `lib` (pure) ← `db` ← `poll`/`notify`/`admin` ← `app`/`index`. `lib` must not import from upper layers.
- `poll/engine.ts::runOnce` is the single orchestrator shared by cron and "run now" (mutual exclusion via `lib/lock.ts` on the `settings.run_lock` key).
- Message wording (TG HTML / email HTML) lives only in `notify/render.ts` — never format notifications inline in engine or routes.
- Config parsing helpers belong to their data layer (e.g. `parseAllowlistSetting` in `db/settings.ts`), not duplicated at call sites.

## Naming Conventions

- Files kebab/lowercase matching exported domain (`cron.ts` exports `minutesToCron`); test files mirror source names.
- Pure functions in `lib/`/`poll/diff.ts` are sync and dependency-free so vitest covers them without mocks.

## Examples

- `src/poll/diff.ts` — reference pure state machine (five presence transitions, fully unit-tested).
- `src/notify/dispatch.ts` — reference channel-matrix gating (suppressed / per-event-type toggles / per-channel realtime×weekly).
