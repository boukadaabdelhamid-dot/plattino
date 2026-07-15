---
name: Mobile raw-fetch admin endpoints
description: Which admin-ish backend routes have no generated api-client-react hook and must use raw fetch from mobile.
---

`/erp/permissions/:userId` (GET/PUT) and `/auth/me` + `/auth/me/password` (PUT) exist on the api-server but were
never wired into orval codegen — even the web ERP calls them via raw `fetch()`, not a generated hook.

**Why:** these routes were added after the last orval regeneration, or codegen skips a handful of routes; the web
ERP's own `Permissions.tsx`/`Settings.tsx` already established the raw-fetch pattern (auth header via stored token,
JSON body, throw a plain `Error` with the server's message so the shared toast/feedback hook still works).

**How to apply:** if you need one of these three routes (or find another route with no matching generated hook),
mirror the same raw-fetch + react-query wrapper pattern (see `artifacts/mobile-app/hooks/use-admin-api.ts`) instead
of assuming a hook is missing by mistake or trying to add a new backend endpoint. Confirm by grepping
`lib/api-client-react/src/generated/api.ts` for the path before concluding no hook exists.
