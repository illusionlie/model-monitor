# Backend Development Guidelines

> Conventions for this Cloudflare Worker (Hono + D1, free-tier constrained). Source of truth for product semantics: `DECISIONS.md` at repo root.

---

## Overview

Single Worker: cron poller (model catalog/channel diff), Telegram + email notifications, password-protected admin, `/feed` endpoint. Everything must fit Workers/D1 **free tier** (50 subrequests per invocation incl. D1, 10ms CPU with occasional bursts, 100k D1 written rows/day).

---

## Guidelines Index

| Guide | Description | Status |
|-------|-------------|--------|
| [Directory Structure](./directory-structure.md) | Module layering (lib/db/poll/notify/admin), single-orchestrator pattern | Filled |
| [Database Guidelines](./database-guidelines.md) | D1 access rules, batch/write-amplification quota, migrations | Filled |
| [Error Handling](./error-handling.md) | Per-source isolation, alert-exactly-once, API error matrix | Filled |
| [Quality Guidelines](./quality-guidelines.md) | Forbidden/required patterns, testing requirements, review checklist | Filled |
| [Logging Guidelines](./logging-guidelines.md) | `[component] key=value` format, secrets policy | Filled |

---

## Key Gotchas Learned (2026-10, initial build)

1. **TG 1 msg/s is cross-message**: throttling only between segments of one sendMessage batch still 429s when realtime + weekly send back-to-back — keep the module-level `lastSendAtMs` throttle.
2. **Hash short-circuit must still advance delisted confirmation**: an unchanged body means "still absent", which is the 2nd strike for a `missing=1` model.
3. **Same-round catalog dedup needs memory**: events persist at round end; a DB lookup misses catalog B adding a model catalog A added earlier in the same round.
4. **Weekly gate math**: compute the Friday 21:00 Asia/Shanghai deadline from a date truncated to 00:00 — adding the time-of-day twice silently moves the deadline to Saturday 18:00.
5. **CI TOML insertion**: top-level keys (`routes`) must be sed-inserted before the first table header (`[[d1_databases]]`/`[[send_email]]`), or they attach to the wrong table.
6. **`wrangler d1 list --json` returns a bare array** (v4) — CI jq expressions are written against that shape.
7. **workerd production caps WebCrypto PBKDF2 at 100,000 iterations**: `deriveBits` above that throws `NotSupportedError` in production, while `wrangler dev` does NOT enforce the cap — local passes, prod 500s. `lib/crypto.ts` pins `100_000`; Node-based vitest also doesn't enforce, so tests can't catch this class.

---

**Language**: All documentation should be written in **English**.
