---
name: ERP typecheck pre-existing failures & api-server rebuild model
description: Why `pnpm --filter @workspace/erp typecheck` fails out of the box, and how backend route changes go live.
---

## ERP has pre-existing, systemic typecheck failures
`pnpm --filter @workspace/erp run typecheck` reports ~12 errors that exist independent of
most changes (in use-me.ts, OnlineOrders, Products, PurchaseOrders, RealTime, SelectStore,
Suppliers). The dominant class is orval + TanStack Query v5 friction: generated query hooks
type their `query` option as `UseQueryOptions<...>`, which **requires `queryKey`**. So a call
like `useGetX({ query: { enabled } })` fails typecheck because `queryKey` is missing.

**Why it doesn't break the app:** Vite/esbuild transpiles without type-checking, so the app
runs fine at runtime despite these errors.

**How to apply:**
- Don't assume you broke the build when erp typecheck fails — diff against the pre-existing
  baseline (grep the error list for your own files only).
- To write *new* code that is typecheck-clean without touching the rest, pass an explicit key:
  `useGetX({ query: { enabled, queryKey: getGetXQueryKey() } })` (every query hook has a
  matching `getGetXQueryKey()` export).
- Fixing the whole codebase's pattern is out of scope for a feature task.

## api-server is a bundled build, not HMR
The `artifacts/api-server` dev workflow runs `build && start` (esbuild → `dist/index.mjs`).
It does **not** hot-reload. Backend route/handler edits only go live after restarting the
workflow. Symptom of a stale bundle: a newly added route returns 404 while sibling routes
on the same router work.

**Port-8080 quirk:** two workflows target port 8080 — the live one is
`artifacts/api-server: API Server`; the plain `API Server` fails with EADDRINUSE and should
be ignored. Restart `artifacts/api-server: API Server` to rebuild backend changes.

## `lib/db` is a stale-dist trap for api-server typecheck
`lib/db` is a TS project-reference package (`composite: true`) with a committed
`dist/*.d.ts`. `pnpm --filter @workspace/api-server exec tsc --noEmit -p .` resolves
`@workspace/db` against that committed `dist`, NOT the live source — it does not
transitively rebuild referenced projects.

**Why:** after adding new columns to `lib/db/src/schema/erp.ts`, api-server's typecheck
kept reporting "property does not exist" for the new columns even though the source was
correct, because `dist/*.d.ts` was stale.

**How to apply:** after editing anything under `lib/db/src`, run
`pnpm --filter @workspace/db exec tsc -b --force` before trusting api-server's typecheck
output. If a typecheck error names a schema field you just added and are confident exists,
suspect stale `dist` before suspecting your edit.
