---
name: MIGRATION_SQL drift (api-server bootstrap)
description: How the Replit-boot MIGRATION_SQL relates to schema.ts and the safe way to regenerate it when a fresh DB fails to seed.
---

# MIGRATION_SQL drift vs schema.ts

`artifacts/api-server/src/index.ts` holds a hand-maintained `MIGRATION_SQL` template string run at boot by `runMigrations()`. It splits on `--> statement-breakpoint` and runs each statement, **tolerating** errors whose message contains `already exists` / `duplicate column` / `already been created` (others are logged as non-fatal warnings). This is the ONLY schema bootstrap on Replit.

Railway instead runs `drizzle-kit push --force` (railway.json) before boot, so `MIGRATION_SQL` is effectively inert there. The `.sql` migration files in `lib/db` are run by **neither** environment.

**Why it bites:** `MIGRATION_SQL` drifts behind `lib/db/src/schema/*.ts`. A fresh Replit Postgres DB then boots but `seed.ts` fails on missing tables/columns, so no admin user/data. The `.sql` migration files ALSO drift from schema.ts (e.g. `supplier_operations.type` is `text` in schema but `enum` in the migration; schema adds `actor_user_id`). So the migration files are NOT a reliable source of truth.

**Source of truth = schema.ts**, materialized by `drizzle-kit push --force` into a scratch DB.

**How to regenerate the patch safely (idempotent, additive):**
1. Create scratch DB, `pnpm --filter @workspace/db run push` (force) into it = TARGET.
2. Diff TARGET against the live DB (current MIGRATION_SQL output) via `pg_catalog` (enums, enum values, tables, columns, type diffs, constraints, indexes).
3. Emit: plain `CREATE TYPE` (skip-handler makes it idempotent), `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, `ALTER TYPE ... ADD VALUE IF NOT EXISTS`, plain `ADD CONSTRAINT` (duplicate -> "already exists" -> skipped). Wrap column **TYPE changes** in `DO $do$ ... IF (information_schema.columns ...) THEN ... END IF; END $do$;` so they don't rewrite tables on every boot. `$do$` is safe inside the JS template literal (only `${` interpolates).
4. Order: enums -> enum values -> tables -> columns -> type guards -> FKs/checks (deps exist first).
5. Verify by booting a brand-new empty DB through the real server entrypoint, then reverse-diff that DB vs TARGET (expect 0 differences) and confirm `seed.ts` created `admin@midanic.com`.

**Harmless artifact:** fresh DB ends with both `employees_user_id_fkey` (pre-existing inline `REFERENCES` on the `employees.user_id` ADD COLUMN) and the drizzle-named `employees_user_id_users_id_fk` + `employees_user_id_unique`. Redundant, not harmful.
