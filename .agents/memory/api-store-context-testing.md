---
name: API store context (testing)
description: How the API resolves the active store, needed to exercise store-scoped ERP endpoints from curl/scripts.
---

For authenticated ERP/admin requests, `req.currentStoreId` is read from the **JWT claim** `user.currentStoreId`, NOT from a header.

**Why:** store selection is baked into the token. A plain login token may have `currentStoreId: null` (when the user has multiple stores), so store-scoped writes (create product, bulk images, transfers, etc.) fail until a store is chosen.

**How to apply when testing:**
1. `POST /api/auth/login` → base token.
2. `POST /api/auth/select-store {storeId}` (with base token) → returns a **new** token carrying `currentStoreId`. Use that token for all store-scoped calls.
3. Public storefront (web-store) is different: anonymous/customer requests resolve the store via `?store=<slug>` query or `X-Store-Slug` header (`lib/store-context.ts resolvePublicStore`), falling back to the first active store.

There is no `/api/stores` route. Store lists: `/api/erp/stores/all` (auth) or `/api/stores/public`.
