---
name: Global contact ID balance sync
description: How cross-store balance unification works via contacts.global_contact_id (Tasks #7+#8).
---

# Global contact ID — cross-store balance sync

## The rule
`contacts.global_contact_id` (nullable text UUID) is the canonical linking key for contacts across stores. All contacts sharing the same `global_contact_id` form one "global identity" whose customer balance and supplier balance are kept in sync.

**Why:** `globalSupplierId` on `suppliers` already handled cross-store supplier balance sync, but had no parallel for customer-role or for the unified contacts model. `global_contact_id` on contacts provides one mechanism for both roles (customer + supplier) without separate global ID fields per role.

**How to apply:**
- After ANY balance change, call `syncLinkedContactBalances(tx, contactId)` with the `contact_id` of the entity in the CURRENT store. The function reads `global_contact_id`, finds all sibling contacts, and copies the updated balance to their linked `customer_profiles` and/or `suppliers`.
- `syncLinkedSupplierBalances` (legacy) still runs alongside for non-contact-linked suppliers (those with `globalSupplierId` but no `contactId`).
- Import-to-stores: both customer and supplier import now create a contact in each target store with the same `global_contact_id`, then link the new profile/supplier to that contact.

## ON CONFLICT bug (fixed)
After Task #5 added `UNIQUE (user_id, store_id)` on `customer_profiles`, the customer operation balance upserts had `ON CONFLICT (user_id)` which PostgreSQL rejected ("no unique constraint matching"). Fixed to `ON CONFLICT (user_id, store_id)` in POST, PUT, DELETE of `/erp/customers/:id/operations`.

## Credit limit (Task #7)
No separate code needed: once balance sync is in place, the local `customer_profiles.currentBalance` equals the global balance. The existing credit limit check (which reads the local balance) is sufficient.
