---
name: Global contact ID balance sync
description: Cross-store balance unification via contacts.global_contact_id — centralized mutators, boot-migration collision guard, and advisory-lock ordering.
---

# Global contact ID — cross-store balance sync

## The rule
`contacts.global_contact_id` (nullable text UUID) is the ONE canonical cross-store identity key. All contacts sharing it are the same physical person/company; their customer-role and supplier-role balances are kept in sync, and `contacts.current_balance` is always `customer_profiles.current_balance + suppliers.current_balance` for that contact.

**Why:** A contact's balance must be identical regardless of which store or role you view it from. `globalSupplierId` alone only unified supplier rows; it had no equivalent for customer rows or for a single contact playing both roles (customer_supplier) — those could silently drift apart. `global_contact_id` is the one key that covers both axes.

**How to apply:**
- Never write `customer_profiles.current_balance` or `suppliers.current_balance` directly. Route every balance-changing operation through `mutateCustomerBalance(tx, userId, storeId, op)` / `mutateSupplierBalance(tx, supplierId, op)` in `lib/balance-sync.ts` — they apply the delta/absolute, run legacy per-role sync, resolve the contact, recompute `contacts.current_balance`, and fan out to every linked sibling contact via `syncLinkedContactBalances`. This includes "opening balance" values set at row-creation time — insert the row at 0 and apply the real value through the mutator afterward, so it can't race a sibling-adopt/legacy-sync step.
- `linkContactsGlobally(tx, contactIdA, contactIdB)` is the ONLY place a contact's `global_contact_id` is assigned. It is merge-safe: handles neither/one/both-already-linked (different groups → merges the whole second group onto the first).
- A store can hold only one contact per `global_contact_id` (unique index `contacts_one_global_per_store`) — this is intentional and can surface real pre-existing data ambiguity (same person, same store, two separate contact rows across roles). Migrations/imports must skip-not-crash on this, not assume it can't happen.

## Boot migration: same-store collision guard (twice-encountered, both passes need it)
The one-time backfill migration (`contact-global-link-migration.ts`) links pre-existing suppliers/customers into groups in two passes (supplier-side, then customer-side). On real dev data, Pass B crashed on the `contacts_one_global_per_store` unique index because messy pre-existing data could put two DIFFERENT contacts in the same store under the same target gcid. Pass A originally lacked the same guard — added defensively even though a clean run of Pass A alone can't violate it, because messy/partial re-runs are exactly when structural assumptions break. Fix: every `UPDATE contacts SET global_contact_id = ...` in this migration needs a `NOT EXISTS (SELECT 1 FROM contacts other WHERE other.store_id = c.store_id AND other.global_contact_id = <target> AND other.id <> c.id)` guard, skipping rather than crashing.

## Concurrency: per-identity advisory locking with multi-key deadlock-safe ordering
Concurrent transactions mutating DIFFERENT roles of the SAME identity (customer-side in one call, supplier-side in another) can interleave their read-then-write `recomputeContactBalance` calls and lose one side's delta. Fix: `mutateCustomerBalance`/`mutateSupplierBalance` acquire `pg_advisory_xact_lock(hashtext(key))` BEFORE mutating.

**The subtle part:** a single lock key is not enough pre-`global_contact_id`. Two DIFFERENT axes need protecting and neither key alone covers both:
- Cross-store same-role fan-out (legacy, keyed by `userId` for customers / `globalSupplierId` for suppliers — this is what `syncLinkedCustomerBalances`/`syncLinkedSupplierBalances` actually key off of).
- Same-store dual-role fan-out (customer + supplier row sharing one `contactId` in one store).

A `contact:{contactId}` key does NOT protect the cross-store case (contactId is store-scoped — different per store row), so prioritizing it over the legacy key breaks cross-store serialization. The fix acquires **both** applicable keys (once `global_contact_id` exists, that one key covers everything and is used alone), de-duplicated and **sorted into one fixed global order shared by every caller** before acquiring them one at a time — this is what prevents a lock-ordering deadlock between a customer-side transaction and a supplier-side transaction each needing two different, partially-overlapping keys. See `lockIdentityGroup()` in `lib/balance-sync.ts`.

## ON CONFLICT fix in customer balance upserts
After adding the compound unique index `(user_id, store_id)` on `customer_profiles`, upserts must target `ON CONFLICT (user_id, store_id)`, not `ON CONFLICT (user_id)` (Postgres rejects a conflict target with no matching unique constraint).

## Credit limit check cross-store
No extra code needed: once balance sync is in place, `customer_profiles.currentBalance` always equals the global running total, so the existing credit-limit check (reads the local balance) is accurate cross-store automatically.
