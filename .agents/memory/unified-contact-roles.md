---
name: Unified contact identity + label-only role changes
description: contacts table is the identity; customer/supplier are native role-extension rows linked by nullable contact_id; type changes are bidirectional label flips — role rows are NEVER deleted.
---

# Unified contact system (Phase 2)

`contacts` is the single identity table for shared fields (name, contactName, email,
phone, address, notes, contactType). The customer role = users + customer_profiles;
the supplier role = suppliers. Each role table has a nullable `contact_id` FK with a
partial unique index (one role row per contact per table). List membership is driven
by the NATIVE role rows, not by contactType — a `customer_supplier` shows in both
lists because it owns one customer_profiles row AND one suppliers row under one contact.

## Bidirectional type changes, label-only (deliberate)

Both directions are allowed via the edit endpoints: promotion (single role →
customer_supplier) creates the missing role row in the same transaction; downgrade
(customer_supplier → single role) only flips the contactType LABELS — on the edited
side, on contacts, and on the counterpart role row (reset to its base type,
contact-wide across stores sharing the contactId). Role rows are NEVER deleted.

**Why:** a role row may carry financial history (supplier balance/operations, customer
orders/balance). Deleting on downgrade would lose data and risk FK breakage. The old
409-reject-downgrade guard was removed: it conflated "changing the display label" with
"deleting role data". Verified safe because contactType is only read in display paths
(unified-balance filters, statement merges, canonical-balance CASEs); every balance
write and cross-store sync is keyed on contactId/userId, never on contactType.

**How to apply:** all create/update flows are transaction-scoped (customer PUT wraps
user update + profile upsert + contact maintenance + role-ensure/label-reset in ONE tx).
After downgrade each side displays its own role balance instead of the unified contacts
balance — expected. Cross-store siblings under a DIFFERENT contact keep their type; the
import "Type mismatch" report covers that (pre-existing). Legacy rows keep contact_id
NULL and link lazily on first edit. ERP dialogs must close only on onSuccess and surface
API errors (ApiError.data.error) — onSettled-close silently swallowed the old 409s.
