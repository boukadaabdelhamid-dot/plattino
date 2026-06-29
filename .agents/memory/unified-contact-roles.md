---
name: Unified contact identity + one-way role promotion
description: contacts table is the identity; customer/supplier are native role-extension rows linked by nullable contact_id; roles only promote, never downgrade.
---

# Unified contact system (Phase 2)

`contacts` is the single identity table for shared fields (name, contactName, email,
phone, address, notes, contactType). The customer role = users + customer_profiles;
the supplier role = suppliers. Each role table has a nullable `contact_id` FK with a
partial unique index (one role row per contact per table). List membership is driven
by the NATIVE role rows, not by contactType — a `customer_supplier` shows in both
lists because it owns one customer_profiles row AND one suppliers row under one contact.

## One-way role promotion (deliberate)

A `customer_supplier` CANNOT be reduced to a single role via the edit endpoints. Both
supplier PUT and customer PUT detect a linked counterpart role and reject the
downgrade with **409**. Promotion (single role → customer_supplier) is allowed and
creates the missing role row in the same transaction.

**Why:** a role row may carry financial history (supplier balance/operations, customer
orders/balance). Deleting it on downgrade would lose data and risk FK breakage — and
the project constraint is strictly additive/reversible, no deletion. Silent auto-correct
would hide intent, so we fail loudly instead.

**How to apply:** all create/update flows are transaction-scoped (customer PUT wraps
user update + profile upsert + contact maintenance + role-ensure in ONE tx so the
visible edit can't commit while unified state fails). Legacy rows keep contact_id NULL
and are untouched (no backfill); they link lazily on first edit. Don't add a downgrade
path without explicit deactivation semantics + list filtering.
