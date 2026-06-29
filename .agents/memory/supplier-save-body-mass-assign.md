---
name: Supplier save whitelists shared fields (no mass-assign)
description: /erp/suppliers POST+PUT whitelist only shared contact fields + contactType; currentBalance/globalSupplierId/storeId are never assignable via create/edit.
---

# Supplier create/update must whitelist, never mass-assign

`POST /erp/suppliers` and `PUT /erp/suppliers/:id` build an explicit `set`/insert
object from ONLY the shared contact fields: `{ name, contactName, email, phone,
address, notes, contactType }` (plus the managed `contactId` link). They do NOT
spread `req.body`.

**Never assignable via create/edit:** `currentBalance`, `globalSupplierId`,
`storeId`. Balance changes go exclusively through the dedicated adjust/operations
routes.

**Why:** suppliers and customers share a rich form (`components/ContactFormDialog.tsx`).
Spreading the whole form body would silently overwrite `current_balance` and persist
unrelated columns, corrupting supplier ledgers.

**How to apply:** any supplier (or customer) create/edit must map only the
whitelisted shared fields into the payload. `contactType` IS a valid supplier column
now (enum: supplier | customer_supplier on that table) and drives the unified-contact
role linkage — keep it in the whitelist. If you ever refactor customer save to a
generic body insert, apply the same whitelist discipline.
