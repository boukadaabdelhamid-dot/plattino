---
name: Supplier save mass-assigns the request body
description: /erp/suppliers POST+PUT persist whatever fields are in the body; currentBalance is NOT stripped on PUT despite the comment.
---

# Supplier create/update persist the raw request body

- `POST /erp/suppliers` → `db.insert(suppliersTable).values({ ...req.body, storeId })` (only `globalSupplierId` is deleted).
- `PUT /erp/suppliers/:id` → `db.update(...).set({ ...req.body })` deleting only `storeId` and `globalSupplierId`.

**The PUT comment claims it protects balance from mass-assignment, but the code does NOT delete `currentBalance`** — so `currentBalance` (and any other supplier column present in the body) IS mass-assignable on edit.

**Why:** when reusing a rich/shared contact form (e.g. the customer "Nouveau client" 4-tab form, now `components/ContactFormDialog.tsx`) for suppliers, sending the whole form would silently overwrite `current_balance` and persist unrelated fields, corrupting supplier ledgers.

**How to apply:** any supplier create/edit UI must map ONLY `{ name, contactName, email, phone, address, notes }` into the create/update payload. `contactType` is not a supplier column. Balance changes must go through the dedicated adjust/operations routes, never the generic create/PUT. (Same caution applies if customer save is ever refactored to a generic body insert.)
