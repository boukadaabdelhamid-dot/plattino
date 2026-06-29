---
name: Cross-store global supplier account
description: How suppliers share ONE balance across stores via globalSupplierId, the sync model, and its deliberate concurrency tradeoff.
---

# Global shared supplier account (across stores)

Suppliers linked across stores by `suppliers.global_supplier_id` (nullable text UUID) share ONE balance: a payment/adjust/PO-receive on any linked record must show the same solde in every store.

## Model: duplicated balance + copy-on-change
- Each store keeps its OWN `suppliers` row with its own `current_balance` column (the rest of the app reads that column unchanged — that's why we duplicate rather than centralize).
- `syncLinkedSupplierBalances(tx, supplierId, gsid)` runs INSIDE the same transaction right AFTER each existing balance update; it copies the source row's new balance to every other row with the same gsid. **No-op when gsid is null**, which is what keeps unlinked suppliers and caisse logic completely untouched.
- **Why duplicated, not a single global balance row:** a central balance would force rewrites of every supplier-balance read across the app. The user constraint was explicit (Arabic): only ADD sync, do NOT touch caisse/cashbox or existing balance math/sign convention.

## Sign convention (do not flip)
`Solde = Versements − Achats`. **Debt is NEGATIVE** (owe 300 → balance `-300.00`; pay 100 → `-200.00`). Payment operation increases balance toward 0.

## Integrity / security guards (added on top, safe)
- `globalSupplierId` is managed ONLY by `POST /erp/suppliers/:id/import-to-stores`. Generic create/update routes **strip it from the body** (mass-assignment guard) — never relink via the generic edit route.
- Partial unique index `suppliers_one_global_per_store (store_id, global_supplier_id) WHERE NOT NULL` prevents split/duplicate groups; plus a partial lookup index on `global_supplier_id`.
- Import endpoint authorizes target stores against the caller's `user_stores` membership (returns per-store `status:"error"` for non-member stores) and locks the source row `FOR UPDATE` so concurrent first-imports can't mint split gsids.
- Import per-store result statuses: `created | linked_existing | already_linked | conflict | error`. `conflict` = a same-name supplier already linked to a DIFFERENT gsid (refuses silent merge).
- `GET /erp/suppliers/:id/operations` aggregates ops from ALL linked rows (inArray on gsid group), leftJoins stores for storeNameAr/En, returns a unified runningBalance.

## Known, deliberate limitation (flagged, NOT fixed)
Two simultaneous balance ops on the SAME supplier in DIFFERENT stores can deadlock (each tx locks its local row first, then sync tries the other's). Postgres aborts one tx → **clean full rollback (HTTP 500 + retry), NOT balance corruption** (row locks serialize the additive updates). Left unhardened on purpose: deterministic group-locking would restructure the balance-update flow the user said not to touch, and same-supplier cross-store simultaneity is extremely rare in this small ERP.

**How to apply:** if you ever DO need to harden it, lock the whole gsid group `FOR UPDATE ORDER BY id` BEFORE the local balance mutation at all three call sites (payment in `/operations`, `/adjust`, PO-receive) — and re-confirm the sign convention above.
