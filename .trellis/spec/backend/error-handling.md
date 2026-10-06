# Error Handling

> Failure isolation is the core pattern: one source failing must never break the poll round, the notification layer, or the Worker.

---

## Overview

Errors are classified at the boundary where they occur, recorded as short state (not stack traces), and surfaced through UI/feed where the user needs them. Only cross-source/alerting conditions become notifications.

---

## Error Types

Three fetch-failure classes (logged with source name, stored abbreviated in `sources.last_error`, ≤200 chars):
1. **network** — fetch rejected / timed out (15s `AbortSignal`);
2. **http** — non-2xx status (include status code);
3. **parse** — body hash changed but JSON/shape parse failed.

---

## Error Handling Patterns

- `poll/engine.ts` wraps **each source** in try/catch: failure → `recordFailure` (increment `consecutive_failures`), continue with next source. The whole `runOnce` is additionally wrapped (scheduled entry) so cron never dies silently.
- **Alert-exactly-once pattern**: at `consecutive_failures == 3 && fail_alerted == 0` → emit `source_fail` event + set `fail_alerted=1`; further failures stay silent. Success with `fail_alerted=1` → `source_recovered` event + reset both. Never alert on every failing run.
- Notification send failures (TG segment, email) are `console.error` + move on; they never throw into the engine and never mark events back.
- Hash short-circuit ≠ failure: unchanged body still advances the 2-strike delisted confirmation (a model absent from an unchanged response is still absent — see `findMissingModelIds` call in the short-circuit branch of `engine.ts`).

## API Error Responses

Admin/feed routes return JSON `{ error: string }` with proper status:
- 400 validation (e.g. deleting a built-in catalog source, bad source payload)
- 401 auth (missing/bad cookie, wrong feed secret, wrong password)
- 404 `/setup` after initialization (permanent)
- 405 wrong method
- 409 run lock held (`POST /admin/api/run` while a cron round is active)

## Common Mistakes

- Alerting on every failed probe (notification storm) — use the `fail_alerted` flag.
- Letting a 5.3MB models.dev parse blow up the round — parse happens only after hash change; per-source isolation covers the rest.
- Treating "no events this round" as an error — it is the normal steady state.
