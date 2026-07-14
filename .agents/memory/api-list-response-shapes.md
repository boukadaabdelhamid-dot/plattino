---
name: API list-response envelope shapes vary per endpoint
description: Which generated hooks return a bare array vs a paginated {data:[...]} vs a differently-named field — check the schema before writing `?.data ?? []` fallbacks.
---

Generated list hooks in `lib/api-client-react` do NOT share one envelope shape. Confirmed shapes:
- `useGetProducts` → `ProductsResponse { products: Product[], total, page, limit }` — field is `products`, NOT `data`.
- `useGetErpCustomers` → `PaginatedCustomers { data: CustomerSummary[], total, page, limit }` — field is `data`.
- `useGetAdminOrders` → bare `Order[]` (no envelope).
- `useGetAdminRetours` → bare `BonRetour[]` (no envelope).

**Why:** a generic `(data as any)?.data ?? data ?? []` fallback silently returns the whole envelope object (not an array) whenever the real field is named something else (e.g. `products`), and `.filter`/`.map` on that throws at render time — this crashed a new mobile-app order-creation screen (and was found to already be latent in the existing product list screen) with a hard-to-diagnose `TypeError: ... .filter is not a function` caught only by the app's top-level ErrorBoundary (generic "unexpected error" screen, no visible cause without opening the browser console).

**How to apply:** before consuming any `useGetX` list hook's `data`, grep `lib/api-client-react/src/generated/api.schemas.ts` for the actual response interface/type and read its exact field name — don't assume `.data`. Never write a defensive `?? data ?? []` catch-all fallback for list responses; extract the one correct field explicitly so a shape mismatch fails loudly (empty list / visible error) instead of only surfacing later as a render crash.
