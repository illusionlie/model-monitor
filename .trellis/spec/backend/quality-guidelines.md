# Quality Guidelines

> Gates: `npm run typecheck` (tsc --noEmit, strict) and `npm test` (vitest run) must both be green before any milestone is considered done.

---

## Overview

This project's quality bar is **contract fidelity**: DECISIONS.md is the authoritative spec; code reviews check implementation against it section by section (event semantics §1, storage §4, notifications §5, deployment §7, out-of-scope list §10).

---

## Forbidden Patterns

- Reading business secrets from `env` / wrangler.toml — they are D1 `settings` rows (DECISIONS §5). `src/env.ts` may only declare `DB` and `SEND_EMAIL`.
- Node-only APIs (`node:*` imports, Node globals) in `src/**` — that code runs in the Worker runtime. Node types are enabled in tsconfig for `test/` and `scripts/` only; keep it that way.
- Per-run full upsert of the `models` table (quota rule — see database-guidelines).
- String-interpolated SQL; unescaped interpolation of user/model data into HTML (use the escape helpers in `render.ts` / `ui.ts`; remote data in admin UI goes through `textContent`).
- New features from the §10 not-doing list (price events, RSS, log cleanup, KV, Cloudflare Access, better-auth, admin cron editing).

## Required Patterns

- Time comparisons/weekly gating via `src/lib/time.ts` (Beijing wall-clock in a naive frame — DST-free); all notification timestamps dual-annotated "北京 … (UTC …)".
- Timing-safe comparisons for every secret check (`lib/crypto.ts::timingSafeEqual`: PBKDF2 verify, cookie HMAC, feed secret).
- Cross-message Telegram rate limiting (module-level 1 msg/s throttle in `telegram.ts`) — not just between segments of one message.
- Same-round catalog dedup via the in-memory `roundCatalogAdds` set (events persist at round end, so a DB-only check misses two catalogs adding the same model in one round).

## Testing Requirements

- Pure logic (`lib/`, `poll/diff.ts`, `render`/split functions) gets direct unit tests; D1-dependent logic uses an in-memory `D1Database` stub implementing `prepare/bind/first/all/batch`.
- Boundary tests are mandatory for time/cron math: `minutesToCron` edge inputs (empty/0/negative/non-numeric → `*/30`, 59/60/61/90/1440), weekly gate (Fri 20:59 no / 21:00 yes / already-sent / Sat catch-up), TG split (budget, line boundary, tag balance).
- New behavior ships with tests in the same milestone; the final full-scope check re-runs the entire suite.

## Code Review Checklist

- [ ] Contract check against DECISIONS.md sections touched by the change
- [ ] Subrequest budget still ≤50/invocation and write quota re-justified if new writes added
- [ ] No secrets in env/logs; HTML escaping; parameterized SQL
- [ ] Admin routes behind auth middleware; `/setup` still closed post-init
- [ ] typecheck + full test suite green
