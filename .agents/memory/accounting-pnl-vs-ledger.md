---
name: Accounting P&L vs Ledger semantics
description: Two distinct accounting surfaces (P&L vs Ledger); returns deduct LOST MARGIN (not full refund) in P&L because goods are restocked; the RETOUR-% double-count rule.
---

# Accounting: P&L vs Ledger, and how returns hit profit

There are two DISTINCT accounting surfaces with different semantics — never conflate them:

- **P&L (profit) surfaces — Dashboard `/erp/dashboard/ventes`, Analytics `/admin/analytics`,
  monthly report `/admin/reports/monthly`)**: profit math.
  `grossProfit = revenue − COGS − returnedProfit`, `netProfit = grossProfit − operatingExpenses`.
- **Ledger / Grand Livre (accounting-summary endpoint + caisse/treasury)**: cash-flow balance only.
  `netBalance = Σ(income) − Σ(expense)`. This is NOT net profit. The cash ledger correctly shows
  the FULL cash refund of a return as a cash outflow.

## Returns deduct LOST MARGIN in P&L, not the full refund (the key, non-obvious rule)

A `bon_retour` ALWAYS restocks the goods (`stock += qty` + an `in` inventory movement) in both
creation routes (`/admin/orders/:id/retours` and orderless `/admin/retours`). So the item cost is
recovered as inventory — only the margin is lost. Therefore every P&L surface deducts the
**returned profit**, NOT the refunded amount:

`returnedProfit = Σ bri.quantity × (bri.unit_price − cost)`

- **Cost sourcing:** prefer the original order's `order_items` cost (the exact COGS that was booked),
  via a `(order_id, product_id)`-grouped subquery (`MAX(cost_price)` to avoid fan-out), joined on
  `oc.order_id = br.original_order_id`. Fall back to `products.cost_price` for orderless comptoir
  returns (`original_order_id IS NULL`), then `COALESCE(..., 0)`.
- **Why margin, not full amount:** a fully-returned + restocked sale must net to **0** (no profit, no
  loss), not `−COGS`. Deducting the full refund double-removes the recovered cost and invents fake
  losses (e.g. sell 3 @10000 cost 7000 → margin 9000; return 1 → net must be 6000, not −1000).
- Correct for ALL return types: `sans_remboursement`/avoir returns reduce the customer balance by the
  full sale value while goods are restocked, so the margin reversal still belongs in P&L. Loss-making
  sales (unit_price < cost) yield a negative returnedProfit that correctly reverses the original loss.

## The RETOUR-% double-count rule (still applies)

A cash-refund return (`retour_type = 'remboursement'`) also creates an `expense` transaction with
`reference LIKE 'RETOUR-%'`. Every P&L path MUST exclude these from operating expenses
(`reference IS NULL OR reference NOT LIKE 'RETOUR-%'`) — the refund's profit impact is already
captured once via returnedProfit. Counting the cash refund as an expense too would double-deduct.

**How to apply:** any new report/dashboard showing profit must use
`netProfit = (revenue − COGS) − returnedProfit − operatingExpenses` with the same cost-sourced
returns join AND the RETOUR-% expense exclusion, or it will silently mis-state profit. Display note:
the "Retours" column on these surfaces now shows the margin impact, not the refund amount; the full
cash refund lives in the caisse/treasury ledger.
