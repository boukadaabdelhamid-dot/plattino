---
name: Credit-limit (plafond) dual enforcement
description: à-terme credit-limit is enforced in THREE separate layers (two backend + one frontend gate) that must stay in sync; the projected-balance rule already covers plafond=0 with a creditor balance.
---

# Credit-limit (plafond) dual enforcement

à-terme (credit) sales are limit-checked in THREE separate layers that do NOT
share code:
- POS sale backend: `orders.ts` `handleCreateOrder` — a cheap pre-transaction
  check AND an authoritative in-transaction check (customer_profiles `FOR UPDATE`).
- Manual CRM ops backend: `erp.ts` `/erp/customers/:id/operations` POST and PUT.
- POS frontend gate: `artifacts/erp/src/components/pos/PaymentDialog.tsx` — a
  client-side `termeBlocked` that disables the "À terme" button and shows the
  block message. This is a SEPARATE copy of the rule; the button never fires the
  API when it is disabled, so a backend-only fix is invisible until this is
  updated too (exactly the regression that shipped).

## Rule (the single correct rule for all five sites)
Allow when projected = `current_balance + amount ≤ credit_limit`
(with a +0.001 float tolerance in orders.ts).

**Sign convention:** `current_balance` positive = customer owes the store;
negative = store owes the customer (creditor balance).

**Do NOT add a hard `credit_limit === 0 → reject` guard.** The projected rule
already gives the desired plafond=0 semantics: a non-creditor customer
(balance ≥ 0) is blocked for any receivable, while a creditor customer
(balance < 0) is allowed to buy up to their creditor balance (i.e. until the
projected balance would go positive).

**Why:** a regression shipped when the hard `credit_limit === 0` guard was
removed from erp.ts (relying on the projected rule) but left in orders.ts, so
POS credit sales were wrongly blocked for customers the store owed money to.

**How to apply:** any change to the credit-limit rule must be mirrored across
ALL five sites (orders.ts ×2, erp.ts ×2, AND the PaymentDialog.tsx client gate),
or the POS path, the CRM path, and the button-enable state diverge again. The
frontend gate is UX-only (backend stays authoritative), but if it is stale the
disabled button hides an otherwise-valid sale — a backend-only fix looks broken.

## Known residual (out of scope, watch for it)
erp.ts reads the unified contact balance for customer_supplier contacts
(`c.current_balance` when linked), while the orders.ts POS path reads only
`customer_profiles.current_balance`. A customer_supplier whose creditor balance
sits on the supplier side would still be blocked at POS while the equivalent
ERP op is allowed.
