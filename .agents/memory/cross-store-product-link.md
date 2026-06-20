---
name: Cross-store product linkage
description: How "the same product" is identified across stores — there is no link table.
---

## Products are linked across stores by reference-then-barcode, not by a join table

The same physical SKU exists as a separate per-store `products` row in each store. There is
**no persistent cross-store link table**. The identity key is a single value:

```
matchKey = (product.reference || product.barcode || "").trim()   // reference first, else barcode
```

A product in another store is "the same" when its `reference` OR `barcode` equals that key.

**Why:** This keeps cross-store features simple and consistent with how stock physically moves.
The exact same `matchKey` rule is the contract shared by three features — they must stay in
lockstep or they will disagree about what counts as "the same product":
- "Copy to other stores" carries `reference` + `barcode` to the new store's row.
- Inter-store stock transfers match source→destination by this key (`transfers.ts`).
- The read-only cross-store stock panel in the product details dialog uses it too.

**How to apply:** Any new cross-store product feature must use the same single-key rule
(reference first, then barcode), not an ad-hoc `reference==X OR barcode==Y` of two separate
source values. A product with neither reference nor barcode cannot be linked across stores —
surface that to the user rather than silently matching nothing.

## WS stock events are store-scoped (gotcha for cross-store live views)

`new_order` and `stock_transfer_changed` are broadcast only to the affected store(s)' staff,
while `purchase_received` and `low_stock` go to all admins. So a view that shows *all* stores'
stock cannot rely on WS alone to stay live for sales/transfers in other stores — add a poll
backstop (or refetch-on-open) for true cross-store freshness.
