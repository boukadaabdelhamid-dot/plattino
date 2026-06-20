---
name: Orders revenue fan-out trap
description: Summing orders.total_amount over an orders⋈order_items join multiplies revenue by line-item count; revenue/order-total aggregates must use a separate orders-only CTE.
---

# Orders revenue fan-out trap

When a query joins `orders` to `order_items` and then does `SUM(orders.total_amount)`
(or `SUM(orders.discount_amount)`), each order row is duplicated once per line item,
so an order with N items contributes N× its total. This silently inflates revenue,
discount, and any margin/profit derived from them. It only stays hidden when the data
has single-item orders (or, as in the dev DB, no orders at all).

**Rule:** order-level money (total_amount, discount_amount) must be aggregated from
`orders` ALONE. Item-level money (COGS = cost_price×qty, line revenue = unit_price×qty)
goes in a SEPARATE CTE/subquery that does the item join. Combine the two by period/key
with a LEFT JOIN. Returns (`bon_retour_items`) and expenses (`transactions`) likewise
each get their own independent CTE so the order joins never multiply them.

**Why:** the P&L surfaces must reconcile. Net profit = Σorders.total_amount − COGS −
returns − operating-expenses(type='expense', excluding `RETOUR-%` refund txns, which are
already captured by the returns aggregate — counting both double-deducts). This is the
formula used by Analytics (`/admin/analytics`) and Rapport mensuel; the ERP Dashboard
"Bénéfice" (`GET /erp/dashboard/ventes`) was rewritten to mirror it after originally
shipping a single sales CTE that joined items and inflated revenue.

**How to apply:** any new revenue/margin/profit report — grep orders.ts customer report
and product report for the canonical "separate subqueries to avoid row multiplication"
pattern and copy it. Date windows across these reports use
`created_at BETWEEN from::timestamp AND (to::timestamp + INTERVAL '1 day')`.

**Equality caveat:** Dashboard equals Analytics/Rapport only for the SAME scope —
single store + a date range covering the compared data. Analytics/Rapport are
current-store endpoints; Dashboard also supports admin `storeId=all`, which is a
cross-store aggregate and is NOT directly comparable to a single-store Analytics value.
