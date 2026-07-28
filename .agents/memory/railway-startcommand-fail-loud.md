---
name: Railway startCommand must fail loudly
description: Why Railway's api-server boot sequence must use && (with set -e), never ; between steps.
---

The Railway `startCommand` runs multiple steps in one shell: a data-consolidation
script, `drizzle-kit push --force` (schema sync), then the server boot.

If these are joined with `;`, a failed schema-sync step is silently ignored and
the server boots anyway — against a stale schema. This previously caused a
payroll feature to work fine in Replit dev but throw 500s in production,
because the new tables/columns were never actually created there. The gap can
persist for a long time since the app looks healthy (health check passes,
unrelated features work) until someone hits the specific new code path.

**Why:** shell `;` always proceeds to the next command regardless of exit
code; `&&` stops the chain on the first failure. Without `set -e` too, an
internal failure inside a step's own script can also be swallowed.

**How to apply:** any multi-step Railway/Docker startCommand should be
`sh -c "set -e; step1 && step2 && step3"` so a failed migration/setup step
crashes the boot loudly (visible in deploy logs, health check fails) instead
of leaving the server running against an inconsistent database.

Also: to confirm/deny a suspected prod-schema-drift root cause with certainty
(not guesswork), ask the user for the full Railway Postgres connection URL
(`postgresql://user:pass@host:port/db` — the "Connect" tab's full URL, not
just host:port) as a secret, then `psql "$SECRET_NAME" -c "\dt"` /
`\d <table>` directly against production. This is far more reliable than
inferring from railway.json alone.
