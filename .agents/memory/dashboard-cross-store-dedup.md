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
number of linked stores.

## supplier-debts dedup (FIXED — full 3-level key)

```sql
DISTINCT ON (
  COALESCE(
    s.global_supplier_id::text,
    CASE WHEN c.global_contact_id IS NOT NULL THEN 'gc:' || c.global_contact_id ELSE NULL END,
    'id:' || s.id::text
  )
)
FROM suppliers s
LEFT JOIN contacts c ON c.id = s.contact_id
```

Key priority:
1. `global_supplier_id` — set by `import-to-stores` (most explicit link)
2. `contacts.global_contact_id` via LEFT JOIN on `s.contact_id` — covers
   `customer_supplier` contacts and any supplier linked via the contact layer
   WITHOUT going through import-to-stores (the original gap)
3. `'id:' || s.id` — standalone unlinked supplier (stays distinct)

The `storeFilter` must use `s.store_id` (qualified) because the JOIN to
`contacts` adds another table that also has `store_id`.

Balance read is always `s.current_balance` (supplier role only — never
`contacts.current_balance`), so `customer_supplier` accounting is untouched.

## client-receivables dedup (already correct — NO change needed)

```sql
DISTINCT ON (u.id)
FROM customer_profiles cp
JOIN users u ON cp.user_id = u.id
```

`u.id` (users.id) IS the universal cross-store customer identity. A unique index
`customer_profiles_user_store_uniq (user_id, store_id)` prevents duplicate
profiles per store. No `global_contact_id` fallback needed here.

**Why:** `customer_supplier` contacts on the customer side always share the same
`users.id` across stores (user rows are global). The supplier side lacks this
global user anchor, hence the 3-level key requirement there.

**How to apply:** if any new all-stores dashboard aggregation touches `suppliers`,
always LEFT JOIN contacts and use the 3-level COALESCE key above. For
`customer_profiles`, `DISTINCT ON (u.id)` is sufficient.
