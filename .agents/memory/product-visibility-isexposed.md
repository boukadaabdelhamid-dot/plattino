---
name: Product visibility (VITRINE / isExposed)
description: How storefront vs ERP decide which products are visible, and where the isExposed gate lives.
---

The ERP "VITRINE" eye toggle sets `products.isExposed`. Whether a product appears in the web store / mobile storefront is enforced in the **API**, NOT by the frontend.

**Rule:** In `artifacts/api-server/src/routes/products.ts`, `GET /products` and `GET /products/:id` split into two paths:
- **staff/ERP path** — `req.currentStoreId` comes from the JWT (select-store claim) → handlers run with `publicOnly=false` → returns ALL products (exposed + hidden) so admins can see and re-toggle.
- **public path** — `resolvePublicStore` (anonymous/customer; store from `?store=`/`X-Store-Slug`) → handlers run with `publicOnly=true` → adds `eq(isExposed, true)`. List hides unexposed; detail 404s on an unexposed product.

**Why:** The storefront pages (Home, Products) do NOT pass `filterExposed`, and there is no DB-level default that hides products. Before this, the public store showed every product regardless of the VITRINE toggle (toggle looked "broken"). Enforcing on the public path is secure-by-default: new storefront surfaces can't accidentally leak hidden products. Do NOT "fix" this by adding `filterExposed` in frontend queries — that's fragile and was never actually wired.

**Scope caveat:** Only browse/detail are gated. `cart.ts` and order creation validate products by `id+storeId` only, so a hidden product with a known id can still be added to cart / purchased. If "hidden" must also mean "not purchasable", add `isExposed=true` checks to the public cart/order paths too.

**Defaults:** `products.isExposed` DB column defaults `false`; `POST /products` defaults it to `true` when omitted; the ERP "new article" form and the Excel import insert `isExposed=false`. So bulk-imported products are hidden until toggled.
