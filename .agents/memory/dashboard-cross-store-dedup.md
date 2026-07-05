---
name: Dashboard all-stores aggregation must dedup synced cross-store balances
description: cross-store-linked entities carry the SAME synced balance in each store's row; all-stores dashboard SUM/COUNT must dedup by the unifying key or it multiplies by store count.
---

# Dashboard all-stores aggregation must dedup synced cross-store balances

Cross-store-linked records exist as one row per store, each carrying the SAME
synced balance:
- suppliers: linked by `global_supplier_id` (balance synced to siblings)
- customer_profiles: linked by `user_id` (balance pushed to sibling stores)

Any Dashboard aggregation over "Tous les magasins" (storeId=null → no store
filter) that SUMs or COUNTs these rows multiplies each unified entity by the
number of linked stores (e.g. Total Dettes and the creditor count were doubled
for suppliers present in 2 stores).

Fix pattern (dashboard endpoints ONLY — never touch the balance-sync logic):
collapse to one row per unifying key with
`DISTINCT ON (COALESCE(<key>::text, 'id:' || id::text))` ordered by that key then
id, then re-sort in an outer query. The `'id:'` prefix keeps unlinked rows (null
key) distinct and cannot collide with a UUID key.

**Why:** the supplier-debts drill-down (`/erp/dashboard/supplier-debts`) doubled
Total Dettes and the creditor count after supplier balances were unified.

**How to apply:** applied to supplier-debts (key = global_supplier_id). LATENT
same-class gap in `/erp/dashboard/client-receivables` (would double-count a
customer with a positive balance in multiple stores; key = user_id) — left
unfixed because no such customer exists yet and it was out of scope. `general`
(stock) and `caisses` (intentionally org-wide) are not affected.
