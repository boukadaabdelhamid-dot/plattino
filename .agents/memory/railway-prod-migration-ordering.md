---
name: Railway prod migration ordering
description: How production schema/data migrations actually apply on this Railway-deployed monorepo, and the ordering rule for data migrations that must precede a schema change.
---

# Railway prod migrations: push-before-boot, schema is source of truth

The api-server's Railway `deploy.startCommand` (artifacts/api-server/railway.json)
runs `drizzle-kit push --force` against the prod DB FIRST, then starts the server.

**Consequence 1:** the Drizzle schema (`lib/db/src/schema/*.ts`) is the real source
of truth for prod *structure* — tables, columns, enums, indexes are all synced from
it on every deploy. The big inline `MIGRATION_SQL` string + `runMigrations()` in
`artifacts/api-server/src/index.ts` is only a redundant defense-in-depth/local
bootstrap path; drift in it is NOT a prod blocker.

**Consequence 2 (the trap):** `drizzle-kit push --force` does only STRUCTURE sync,
never DATA migration. So any data migration that must happen *before* a structural
change can apply will fail if it lives at server boot, because boot runs AFTER push.
The classic failure: schema adds a UNIQUE (or partial-unique) index, but current
prod data isn't unique yet → push's `CREATE UNIQUE INDEX` fails → deploy never
reaches the server, and the boot-time data fixup never runs. Deadlock.

**Rule:** when a schema change requires the data to be reshaped first (dedup before
a new unique index, backfill before NOT NULL, etc.), run that data migration as a
PRE-PUSH step in `railway.json` startCommand, before `drizzle-kit push --force` —
not at server boot.

**How we did it (caisse global consolidation):**
- Shared SQL/runner in `artifacts/api-server/src/lib/caisse-global-migration.ts`
  (so the pre-push script and the boot safety-net can't diverge).
- Standalone entry `artifacts/api-server/src/consolidate-caisses.ts`, added as a 2nd
  esbuild entryPoint in `build.mjs` → `dist/consolidate-caisses.mjs`.
- startCommand: `node …/consolidate-caisses.mjs && drizzle-kit push --force && node …/index.mjs`.
- Keep the same migration at boot too (idempotent) as a safety net.

**Why:** consolidation merges duplicate caisses so push can create the global
partial-unique indexes on clean data. Creating those indexes inside the pre-push
script too (CREATE UNIQUE INDEX IF NOT EXISTS) also closes the race where an old
live instance inserts a duplicate between consolidation and push.

**Gotcha for idempotency/partial DBs:** guard relations with `to_regclass(...)` so the
runner no-ops on fresh DBs (before the first push) where caisse tables don't exist
yet. Guards here are relation-level, not column-level — fine because prod always
carries the current columns via per-deploy push.
