---
name: Customer PUT balance mass-assign
description: Why profile-edit PUTs must never write current_balance, and the GET/PUT canonical-balance asymmetry that caused corruption.
---

# Never round-trip the canonical GET balance into a role table via profile PUT

**Rule:** `GET /erp/customers/:id` returns a CANONICAL balance — for a
`customer_supplier` contact it is the COMBINED `customer_profiles.current_balance`
(customer side) + suppliers.current_balance (supplier side). A profile-edit
`PUT /erp/customers/:id` must NOT write that value back into
`customer_profiles.current_balance`. Treat `currentBalance` as
non-mass-assignable on the profile PUT, exactly like the suppliers POST/PUT does
(it whitelists fields and never accepts currentBalance/globalSupplierId/storeId).

**Why:** The frontend form always sent `currentBalance` in the PUT body. The PUT
wrote the canonical (combined) value into the customer-side column, then
`recomputeContactBalance` re-added the supplier portion → the balance compounded
on every save. Any edit to an unrelated field (credit limit, address, etc.)
corrupted the balance. Live DB rows were already damaged (e.g. Smoke CS).

**How to apply:**
- Balance changes belong to the dedicated customer operations, never to the
  profile-edit endpoint. Keep "Solde actuel" read-only in the profile form.
- If you must keep `currentBalance` in the payload / destructure, be aware the
  `if (currentBalance !== undefined)` gates decide whether recompute +
  syncLinkedCustomerBalances run from the CURRENT store (truthy) vs the
  adopt-from-sibling else branch. Dropping the field flips that control flow — a
  real behavior change, not a no-op. To fix ONLY the write bug without touching
  sync, delete just the `updateSet.currentBalance` assignment and leave the gates
  intact.
- Known remaining gap (pre-existing, separate task): the upsert INSERT path
  (new cross-store profile) still mass-assigns `insertValues.currentBalance` from
  the body and can push a wrong/zero balance to siblings via sync. Repairing
  already-corrupted rows is also a separate data-fix task.
