---
name: Upload image URL resolution
description: Why upload publicUrl must be absolute, and how local-storage fallback is gated.
---

# Upload / object-storage image URLs

## Storage mode gating
`detectStorageMode()` in `artifacts/api-server/src/lib/objectStorage.ts` must return
`"replit"` ONLY when `(REPL_ID || REPLIT_DEV_DOMAIN)` AND `PRIVATE_OBJECT_DIR` AND
`PUBLIC_OBJECT_SEARCH_PATHS` are all set; otherwise fall back to `"local"`.
**Why:** Replit dev has `REPL_ID`/`REPLIT_DEV_DOMAIN` but NOT the object-storage vars,
so keying off `REPL_ID` alone forced GCS mode and every upload 500'd. Local mode persists
to `<cwd>/.uploads` (auto-created at boot via `ensureLocalStorageReady()` in index.ts).

## Uploaded image URLs must be ABSOLUTE
The ERP (port 3001) and web-store (port 5000) render product images as plain
`<img src={p.imageUrl}>` with **no api-base prepend and no vite proxy**. The API runs on
a different origin (port 8080 in dev). So a relative `/api/uploads/<id>` resolves against
the *frontend* origin and 404s (ERP) or returns the SPA `index.html` (web-store).
**Fix:** `uploadBuffer` returns an absolute url via `buildPublicUrl()`/`getPublicBaseUrl()`,
mirroring the frontends' own `VITE_API_URL` derivation exactly:
dev → `https://<REPLIT_DEV_DOMAIN>:8080`, production → `""` (relative, same-origin),
`PUBLIC_ASSET_BASE_URL` overrides both.
**How to apply:** This project deploys all artifacts same-origin on Railway (`/`, `/erp/`,
`/api/`), so relative prod URLs work. If API and frontend are ever split across domains,
set `PUBLIC_ASSET_BASE_URL` to the API origin or images break.

**Tradeoff noted:** dev-uploaded URLs bake `REPLIT_DEV_DOMAIN:8080` into `product.imageUrl`
(env-coupled data). Acceptable for dev test data; not promoted to prod.
