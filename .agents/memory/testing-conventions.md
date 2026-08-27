---
name: Testing conventions in this monorepo
description: How to add a test here — no test framework is installed; tests are standalone tsx scripts run by hand against the dev DB.
---

No vitest/jest/mocha is installed anywhere in this pnpm workspace (checked repo-wide). The established
pattern (see `artifacts/api-server/src/test-balance-sync.ts` and `test-dashboard-balances.ts`) is:

- A standalone script under `src/` (not a `*.test.ts` file, no test runner) that imports the real `db`/`schema`
  from `./lib/db` and the functions under test directly.
- It creates disposable "scratch" rows (stores, users, contacts, etc.) tagged with a unique run tag, exercises
  the functions under test against them, asserts with small local `assertEqual`/`assertTrue` helpers that
  print `ok`/`FAIL` lines, then deletes the scratch rows in a `finally` block and calls `pool.end()`.
- Run manually with `npx tsx src/<file>.ts`; exits non-zero on any failed assertion.

**Why:** matches the codebase's existing convention instead of introducing a new tool/dependency; runs against
real Postgres (including advisory locks, unique constraints, numeric rounding) which raw-SQL/CTE-heavy code
in this codebase (e.g. `getUnifiedDashboardBalances`) can't be meaningfully unit-tested without.

**How to apply:** when asked to add tests here, follow this exact pattern rather than installing vitest. If a
function to be tested is a local (non-exported) helper, export it so the standalone script can import it.
