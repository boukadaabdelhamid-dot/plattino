---
name: MIGRATION_SQL drift
description: Hand-maintained boot MIGRATION_SQL in api-server/src/index.ts drifts behind lib/db/src/schema/*.ts; Replit runs this on boot (Railway uses drizzle push instead).
---

The boot-time `MIGRATION_SQL` string in `artifacts/api-server/src/index.ts` is a hand-maintained
snapshot of `CREATE TABLE`/`ALTER TABLE` statements. It is only the source of truth for **Replit**
dev environments (fresh Postgres). Railway/production uses `drizzle-kit push --force` instead, so
drift here is invisible there until someone imports/reruns on Replit.

**Why:** schema.ts gets columns added directly (e.g. via `drizzle push` on another env) without the
person also updating the boot SQL string, so a fresh Replit import creates tables missing columns
that the app code (routes, seed/bootstrap) expects — surfaces as `column "X" does not exist` errors
at runtime, not at typecheck time.

**How to apply:** if you see `column "..." does not exist` on a fresh import/boot, find the
`CREATE TABLE` for that table in `artifacts/api-server/src/index.ts`'s MIGRATION_SQL and add an
`ALTER TABLE "..." ADD COLUMN IF NOT EXISTS "..." <type>;--> statement-breakpoint` right after it,
matching the column defined in `lib/db/src/schema/*.ts`. Don't just patch the query — fix the
migration string so future imports don't hit the same error. To fully resync, diff live DB schema
against schema.ts (or a scratch DB from `drizzle push`) rather than eyeballing.

Known fixed instance: `product_types` table was missing `image_url` (text, nullable) — added.
