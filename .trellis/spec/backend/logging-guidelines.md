# Logging Guidelines

> `console.*` only (Workers), consumed via `wrangler tail` / dashboard. No log library.

---

## Overview

Logs exist to debug a serverless cron from the outside: every line carries a component prefix and a subject. Business-critical state lives in D1 (`sources.last_error`, events), not in logs.

---

## Log Levels

- `console.log` — normal round lifecycle: `[poll] round start/end`, source outcomes (seed/diff/no-change counts), weekly report sent.
- `console.warn` — degraded-but-continuing: invalid settings value, notification segment failed but others sent.
- `console.error` — operation failed and user-visible state was affected: all-segments TG failure, email failure, unexpected exception in a source round.

---

## Structured Logging

Format: `[component] key=value ...` on one line.

```
[poll] round start lock=acquired
[poll] source=OpenRouter outcome=diff added=2 delisted=0 missingFirst=1
[poll] source=models.dev outcome=hash-shortcircuit
[poll] source=Zen outcome=failure class=http status=502 consecutive=3
[notify] channel=telegram segments=2 ok
[admin] login ok
```

---

## What to Log

- Round start/end + lock acquisition; per-source outcome class.
- Notification dispatch result per channel; weekly gate decisions (sent/skipped + reason).
- Unexpected exceptions with `error instanceof Error ? error.message : String(error)`.

## What NOT to Log

- **Secrets, ever**: TG bot token, Resend key, feed secret, admin password / session secret, full cookie values.
- Full response bodies (models.dev is 5.3MB) — log size/hash instead.
- Per-model rows in bulk operations — log counts.
