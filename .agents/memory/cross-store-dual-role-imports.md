---
name: Cross-store dual-role imports
description: Accounting and concurrency rules for importing a contact that can be both customer and supplier.
---

Cross-store imports of a dual-role identity must preserve and synchronize the customer and supplier role balances independently. The displayed unified balance is recomputed from those two raw balances; it is never a replacement for either role balance.

**Why:** Copying only the supplier role can make a non-zero customer/supplier balance appear as zero in the target store. Imports also share concurrency with live balance operations, so identity advisory locks must be acquired before row locks to avoid deadlocks.

**How to apply:** Any import, merge, or repair flow must ensure both role rows exist before synchronization, preserve an existing dual-role classification, sync each raw role from the authoritative source, then recompute the unified contact balance.