---
name: api-client-react TS project references
description: After editing lib/api-client-react/src/*.ts, you must rebuild the lib for ERP typecheck to see the changes.
---

## Rule
After editing `lib/api-client-react/src/generated/api.ts` or `api.schemas.ts`, always run:
```
cd lib/api-client-react && pnpm exec tsc --build
```
before running `pnpm tsc --noEmit` in `artifacts/erp`.

**Why:** The ERP's `tsconfig.json` uses TypeScript project references (`"references": [{ "path": "../../lib/api-client-react" }]`). TypeScript reads the lib's `dist/*.d.ts` files (compiled output, not the source). Editing source files without rebuilding leaves stale `.d.ts` files, causing the ERP typecheck to see old signatures — producing confusing errors like "Expected 0-1 arguments, but got 2" on functions you just updated.

**How to apply:** Any time you manually edit `api.ts` or `api.schemas.ts` in the lib, rebuild the lib immediately after. The build is fast (~5s). The lib tsconfig has `composite: true`, `emitDeclarationOnly: true`, `outDir: dist`.

## Paginated API pattern (for future additions)
When adding pagination to a generated endpoint:
1. Add `Params` type + `Paginated*` response type to `api.schemas.ts`
2. Import them in `api.ts` imports block (they don't auto-import)
3. Update `getGetXxxUrl(params?)`, `getXxx(params?, options?)`, `getGetXxxQueryKey(params?)`, `getGetXxxQueryOptions(params?, options?)`, `useGetXxx(params?, options?)`
4. Rebuild lib: `cd lib/api-client-react && pnpm exec tsc --build`
5. Update backend route to return `{ data, total, page, limit }`
6. Update all callers in ERP pages to access `.data ?? []` instead of the flat array

## Backward-compat note
Callers that need ALL records (e.g. editor dropdowns, POS autocomplete) should pass `{ limit: 9999 }` to the paginated hook rather than using a separate "fetch-all" endpoint.
