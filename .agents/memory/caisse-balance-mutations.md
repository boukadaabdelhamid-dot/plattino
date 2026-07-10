---
name: Caisse balance mutation patterns
description: How caisse (cash register/till) balances are mutated safely, and where a lock-ordering deadlock risk exists between routes.
---

## Concurrency model differs from suppliers/customers — and that's fine

Caisses (`caisses` table, `artifacts/api-server/src/routes/caisses.ts`) are global,
single-instance entities (one org-wide "main" + one per staff member; no cross-store
sync, no dual-role/contact unification). Because of that, they do **not** need the
advisory-lock machinery suppliers/customers use (see
`advisory-lock-before-row-lock.md`) — that machinery exists only to serialize a
balance that is shared/unified across multiple rows (contacts, stores, roles).

Two safe patterns coexist in `caisses.ts`:
- Single atomic conditional `UPDATE ... WHERE balance >= X` (used by deposit/withdraw/
  transfer-accept) — safe with no explicit lock because the whole read-compute-write
  is one SQL statement.
- `SELECT ... FOR UPDATE` then compute-then-`UPDATE` inside a transaction (used by the
  target-balance `/erp/caisses/admin/adjust` endpoint, added when it was converted
  from a signed-delta to a target-balance input to mirror the supplier/customer UX) —
  needed here because the delta must be computed from a value read in an earlier
  statement, not expressed as SQL-side arithmetic in one statement.

**Why this mixing is safe:** both patterns ultimately take Postgres's ordinary
per-row lock on the same `caisses` row; there's no second lock primitive (like an
advisory lock) in play for caisses, so there's no cross-primitive lock-order inversion
to worry about the way there is for suppliers/customers.

## Known deadlock risk: admin deposit vs. admin withdraw

`POST /erp/caisses/admin/deposit` and `POST /erp/caisses/admin/withdraw` move money
between a staff caisse and the main caisse, but touch the two rows in **opposite
order** (deposit: staff row then main row; withdraw: main row then staff row). Two
concurrent requests moving money the opposite direction between the same pair can
deadlock. Flagged during code review but left unfixed as of this writing (see the
proposed follow-up task on aligning their lock order) — anyone touching either route
should fix both together, not just the one they're editing.
