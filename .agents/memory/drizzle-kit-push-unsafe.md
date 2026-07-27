---
name: drizzle-kit push unsafe in this environment
description: drizzle-kit push can hang on an interactive prompt or offer to drop unrelated columns; apply schema.ts changes by hand instead.
---

`drizzle-kit push` in this workspace tends to open an interactive confirmation prompt (no non-interactive/yes flag reliably suppresses it here) and can also detect unrelated pre-existing drift (e.g. offering to drop a column nothing in the current change touches) mixed in with the intended change.

**Why:** Blindly accepting the prompt risks applying unrelated destructive drift (dropped columns) alongside the intended schema change, and the tool can hang indefinitely waiting on the interactive prompt in a non-interactive shell.

**How to apply:** When adding/changing tables or columns in `lib/db/src/schema/*.ts`, do not rely on `drizzle-kit push` to sync the live dev DB. Instead: read the current schema.ts definitions for the affected tables, write the equivalent `CREATE TABLE`/`ALTER TABLE` SQL by hand, apply via `psql`, then verify with `\d <table>` that the live DB matches schema.ts exactly (column names, types, defaults, nullability). Only touch the tables/columns relevant to the current change — never accept an offer to drop unrelated columns.
