---
name: Cross-store customer balance unification
description: Decisions/heuristics for keeping the same person's balance identical across linked stores (customer-side mirror of the supplier sync).
---

# Cross-store customer balance unification

`customer_profiles.user_id` is the global cross-store link key for customers (the
same person has the same user_id in every store) — the customer-side analogue of
`suppliers.globalSupplierId`. There is no link table. The canonical per-store
balance is `contacts.current_balance = customer_profiles + suppliers`.

## Rule: after any customer balance mutation, unify the linked stores
Copy the just-updated store's `customer_profiles.current_balance` to the same
user's profile in every other store, then recompute each linked contact.
**Why:** without this, each store accumulates its own balance and the same person
shows different balances per store.
**How to apply:** every writer of `customer_profiles.current_balance` (grep for
them) must be followed, in the same tx, by the sync helper.

## Rule: PUSH on delta/explicit-set, ADOPT-from-sibling on create/link
- Delta or explicit-balance-set op → PUSH from the current store.
- Create/link WITHOUT an authoritative balance → query a sibling profile (same
  userId, different store) and push from IT (adopt), never from the new store.
**Why:** pushing a new store's zero opening balance outward would clobber a real
unified value in sibling stores (data loss). Never push 0 over a real value.

## Rule: the SUM backfill for legacy divergence is run-once, gated, eyeballed
Set each linked profile = SUM of per-store balances (disjoint activity → sum is
the true total), then recompute contacts. Committed as a standalone runbook
script (not auto-wired into deploy/boot).
**Why not auto-run:** a PUT absolute-set can create the same debt in two stores as
two different values; SUM would double-count. So run the pre-divergence report
and eyeball groups with >1 nonzero balance before the first prod run.
**How it stays safe on re-run:** gate on divergent groups
(`COUNT(*)>1 AND COUNT(DISTINCT current_balance)>1`) → no-op once unified.

## Critical rule: never call syncLinkedContactBalances(tx, newContactId) during import/create
Calling `syncLinkedContactBalances` with a **newly created** contact as the source is
always wrong — the new contact has zero balances and will clobber the real balance in
every sibling store. Always sync FROM the existing authoritative sibling contact:
- `import-to-stores` loop: remove mid-loop `syncLinkedContactBalances`; after the
  loop call `syncLinkedCustomerBalances(tx, userId, storeId)` (legacy path) then
  `syncLinkedContactBalances(tx, srcContact.id)` (contact path, covers supplier side).
- Customer `POST /erp/customers` with a sibling: call `syncLinkedContactBalances(tx,
  balSibling.contactId)` not `syncLinkedContactBalances(tx, newContactId)`.
**Why:** `syncLinkedCustomerBalances` pushes cp balance and recomputes contacts but
misses the supplier-side balance for customer_supplier. The contact-path sync covers
both roles. Reading from the new (zero) contact overwrites the sibling's real value.

## Known limitation
Customer import-to-stores creates a supplier row for a customer_supplier WITHOUT
`globalSupplierId`, so the supplier side is not cross-store-linked by that flow —
use the supplier import-to-stores flow for supplier linkage.

## Concurrency note
Simultaneous same-person balance ops in two stores lock the two profile rows in
opposite order → Postgres may abort one with a deadlock (surfaces as 500).
Inherent to the copy-on-sync design; low probability. Watch for it if 500s appear
on POS terme sales.
