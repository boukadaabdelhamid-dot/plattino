---
name: Cross-store customer balance unification
description: How the same person's balance is kept identical across linked stores (customer-side mirror of the supplier sync).
---

# Cross-store customer balance unification

`customer_profiles.user_id` is the global cross-store link key for customers
(the same person always has the same `user_id` in every store) — the
customer-side analogue of `suppliers.globalSupplierId`. There is no link table.

`syncLinkedCustomerBalances(tx, userId, sourceStoreId)` in
`artifacts/api-server/src/lib/balance-sync.ts` COPIES the source store's
`customer_profiles.current_balance` to the same user's profile in every OTHER
store, then recomputes `contacts.current_balance` (= cp + supplier) for each
linked profile with a contact. No-op when the customer exists in only one store.

## Direction rule (push vs adopt) — apply at every balance-mutation site
- **PUSH from current store** after a DELTA or explicit balance set: orders.ts
  (POS vente a terme, cancel, retour, retour comptoir) and erp.ts customer
  operations POST/PUT/DELETE and customer PUT when `currentBalance` is provided.
- **ADOPT from a sibling** (query a profile with same `userId`, `storeId !=`
  current, then push from that sibling) when creating/linking WITHOUT an
  authoritative balance: erp.ts customer create and customer PUT with
  `currentBalance===undefined`. import-to-stores pushes from the source store.

**Why:** pushing this store's zero opening balance outward would clobber a real
unified value in sibling stores → data loss. Never push 0 over a real value.

## Backfill (pre-existing divergence)
One-time SUM: set each linked profile = SUM of per-store balances for that user,
then recompute contacts. Per-store balances are disjoint activity, so SUM = true
total. NOT naturally idempotent — gate on divergent groups
(`COUNT(*)>1 AND COUNT(DISTINCT current_balance)>1`) so re-runs are safe, and run
in a single transaction. Run a pre-report first: PUT absolute-set can create
manually-offset balances where SUM would double-count (eyeball before running).
Prod (Railway) backfill is a separate run-once step (data migration before
drizzle push per railway migration ordering note).

## Known limitation
import-to-stores creates a supplier row for a customer_supplier WITHOUT assigning
`globalSupplierId`, so the supplier side is not cross-store-linked by that flow —
use the supplier import-to-stores flow for supplier linkage.

## Concurrency note
Simultaneous same-person balance ops in two stores lock the two profile rows in
opposite order → Postgres may abort one with a deadlock (500). Inherent to the
copy-on-sync design; low probability. Watch for it if 500s appear on POS terme.
