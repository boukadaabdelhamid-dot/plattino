---
name: Web store config slug — always default principal
description: StoreConfigProvider must always fetch config; never gate the query on slug presence.
---

StoreConfigProvider must NOT gate its config query on slug presence (no `enabled: !!slug`). `getSlug()` must fall back to `"principal"` so the store config (banner, acceptOrders, featuredProductIds, description) is always fetched even when no `?store=` slug is present.

**Why:** Gating on slug left the storefront with no config (missing banner/featured/etc.) on the default domain where no slug is supplied.

**Note:** product visibility (isExposed/VITRINE) is a separate concern — see `product-visibility-isexposed.md`. The storefront does NOT need to pass `filterExposed`; the API enforces it on the public path.
