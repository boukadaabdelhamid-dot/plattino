---
name: Global contact ID balance sync
description: Cross-store balance unification via contacts.global_contact_id — architecture, wiring, and key pitfalls.
---

# Global contact ID — cross-store balance sync

## The rule
`contacts.global_contact_id` (nullable text UUID) is the canonical linking key for contacts across stores. All contacts sharing the same `global_contact_id` form one global identity whose customer balance and supplier balance are kept in sync.

**Why:** Needed to satisfy the requirement that a contact's balance is the same regardless of which store you view it from. `globalSupplierId` already handled cross-store supplier balance sync (via supplier rows), but had no parallel for customer-role rows or for the unified contacts model. `global_contact_id` on the contacts table provides one mechanism for both roles without adding separate global ID fields per role.

**How to apply:**
- After ANY balance change in a customer or supplier operation, call `syncLinkedContactBalances(tx, contactId)` with the contact_id of the current store's entity. The function reads `global_contact_id`, finds all sibling contacts, and copies the updated balance to their linked `customer_profiles` and `suppliers`.
- `syncLinkedSupplierBalances` (legacy) still runs alongside for non-contact-linked suppliers (those with `globalSupplierId` but no `contactId`).
- Import-to-stores: both customer and supplier import generate/reuse `global_contact_id`, create a contact in each target store, and link the new profile/supplier to that contact.

## ON CONFLICT fix in customer balance upserts
After adding the compound unique index `(user_id, store_id)` on `customer_profiles`, the customer-operation balance upserts had the wrong conflict target `ON CONFLICT (user_id)` — PostgreSQL rejects this when there is no standalone unique constraint on `user_id`. Fixed to `ON CONFLICT (user_id, store_id)` in all three customer operation mutation endpoints (POST/PUT/DELETE).

## Credit limit check cross-store
No extra code needed: once balance sync is in place, the local `customer_profiles.currentBalance` always equals the global running total. The existing credit limit check reads the local balance and is therefore accurate cross-store automatically.
