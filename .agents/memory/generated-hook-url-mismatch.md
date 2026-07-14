---
name: Generated hook name doesn't guarantee the route you assume
description: A generated useGetX hook's name can resemble a different, richer backend route than the one it actually calls — verify the literal URL before typing the response shape.
---

`useGetLowStock` (in `lib/api-client-react/src/generated/api.ts`) actually calls `GET /admin/low-stock` (`requireAdmin`-gated, returns plain `productsTable` rows via Drizzle — a real camelCase `Product[]`, no supplier join). It does NOT call the more obviously-named, richer `GET /erp/purchases/needed` route in `artifacts/api-server/src/routes/erp.ts`, which joins in supplier history and returns raw snake_case SQL columns (`designation`, `min_stock`, `cost_price`, `supplier_id`, ...) — that route exists in the backend but is currently unwired to any generated client hook.

Building a consumer against the snake_case shape (assumed from the similarly-named backend route) silently produced `undefined` for every field read off the actual camelCase `Product` objects returned by the hook — no crash, just blank/wrong-looking form fields (blank product name, wrong quantity fallback, empty unit cost, no error thrown).

**Why:** hook/route naming similarity is not proof of identity. The generated client's `getGetXUrl()` function is the only source of truth for which literal path a hook hits.

**How to apply:** before writing a type for a `useGetX` hook's `data`, open `lib/api-client-react/src/generated/api.ts` and read the `getGetXUrl()` (or equivalent) function to get the literal path, then find that exact route (`grep` the literal path string, not the hook name) in `artifacts/api-server/src/routes/*.ts` and read its handler to confirm the real response shape. Also check the route's own auth middleware (e.g. `requireAdmin` vs a permission-section check) — a frontend permission gate that's looser than the backend's will let non-privileged users reach a screen that 403s.
