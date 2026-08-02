---
name: Order source classification (pos vs online)
description: Why order channel is derived from auth, and the expired-token trap
---

Order channel is derived server-side: authenticated staff creator ⇒ `pos` + seller recorded; no user ⇒ `online` guest order.

**Why:** POST /orders is a public checkout endpoint shared by storefront and POS. Any path that lets a staff request through *without* its identity silently reclassifies a counter sale as an anonymous online order — wrong channel stats, no seller audit, no caisse credit.

**How to apply:**
- Order creation uses a strict optional-auth: a *present but invalid/expired* Bearer token must be rejected 401 ("session expirée"), never silently ignored. No header at all = legitimate guest.
- Never (re)introduce boot-time backfills that flip `order_source` on rows that already have a value — an earlier per-boot `pos`+no-seller→`online` rewrite corrupted data on every restart and undid manual corrections.
- User-account emails are canonical lower(trim()); enforced by unique index `users_email_canonical_uq` and `normalizeEmail()` on every users.email write/lookup. Login matches case-insensitively — a raw-equality write path would let case-variant duplicate accounts break login determinism.
