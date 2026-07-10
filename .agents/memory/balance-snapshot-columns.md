---
name: balance snapshot columns (ancien/nouveau solde)
description: customer_operations/supplier_operations/caisse_movements have real balanceBefore/After columns; adjustment endpoints deliberately snapshot the unified balance, not the raw role balance.
---

`customer_operations`, `supplier_operations`, and `caisse_movements` each have
nullable `balanceBefore`/`balanceAfter` columns, populated at write time from
the actual locked mutation result (never guessed after the fact from the
movements list). Pre-existing rows are left NULL and rendered as "—" — no
backfill.

## Adjustment endpoints are the one deliberate exception
The customer/supplier "ajustement" (adjust-to-target-balance) endpoints
snapshot the **unified contact balance** (`contacts.current_balance`) into
`balanceBefore`/`balanceAfter`, NOT the raw per-role balance that
`mutateCustomerBalance`/`mutateSupplierBalance` itself computes and returns.

**Why:** these endpoints already generate a free-text "Ancien: X → Nouveau: Y"
note in unified terms (the whole point of "adjustment" is "set the unified
balance to this target"). For a dual-role (`customer_supplier`) contact, the
raw per-role balance and the unified balance can differ — showing two
contradictory numbers on the same row would be confusing. Every other
operation type (payment, versement, remboursement, vente_a_terme, caisse
movements) snapshots the raw per-role/per-caisse balance from the mutator,
which is identical to the unified balance for non-dual-role contacts anyway.

**How to apply:** if you add a new operation type or touch these snapshot
columns, keep this distinction — only "ajustement" targets the unified
balance; everything else targets the raw role/caisse balance being mutated.
