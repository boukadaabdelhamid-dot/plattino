---
name: Advisory lock must come before row locks
description: Read-compute-write handlers that call mutateCustomerBalance/mutateSupplierBalance must acquire the identity's advisory lock first, not a raw row lock, or lock order inverts and deadlocks under concurrency.
---

## The rule

`mutateCustomerBalance` / `mutateSupplierBalance` (in `artifacts/api-server/src/lib/balance-sync.ts`)
serialize concurrent balance changes on the same identity via a Postgres advisory
lock (`pg_advisory_xact_lock`), acquired as the very first thing they do —
exposed as `lockCustomerIdentity(tx, userId, storeId)` / `lockSupplierIdentity(tx, supplierId)`.

Any handler that needs to **read** the current balance, compute something off it
(e.g. a delta from a user-typed target), and only **then** call
`mutateCustomerBalance`/`mutateSupplierBalance` (the "balance adjustment" pattern)
must call the matching `lock*Identity` helper as its very first step in the
transaction — not a raw `SELECT ... FOR UPDATE` on the profile/supplier/contact row.

**Why:** advisory locks are reentrant per transaction, so calling `lock*Identity`
and then the `mutate*` function (which re-acquires the same key) in the same
transaction is safe and effectively free the second time. But if a handler takes
an explicit row lock (`FOR UPDATE`) *before* calling `mutate*`, while every other
`mutate*` caller takes the advisory lock first and only touches the row later
(implicitly, during its `UPDATE`), the two lock types can be acquired in opposite
order by two concurrent transactions — a classic deadlock cycle that Postgres's
detector will catch and abort one side of, surfacing as an unexplained 500 under
real concurrent load. This exact bug was introduced independently in both the
supplier and customer balance-adjustment endpoints and required an explicit
review pass (with a live mixed concurrent-request test) to catch and fix.

**How to apply:** any new "type a target value, we compute+apply the delta"
endpoint for a balance-bearing identity must open its transaction with
`await lockCustomerIdentity(tx, ...)` or `await lockSupplierIdentity(tx, ...)`
before any `SELECT` of the balance it's about to read, then read with a plain
(non-locking) `SELECT`.
