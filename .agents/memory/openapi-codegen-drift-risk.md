---
name: openapi.yaml drift can silently delete generated API hooks
description: Running orval codegen from openapi.yaml can wipe out generated hooks/types for real backend endpoints that were never added to the spec, breaking unrelated pages.
---

`lib/api-spec/openapi.yaml` is the source of truth orval regenerates `lib/api-client-react/src/generated/*` and `lib/api-zod/src/generated/*` from. In this codebase some real, in-use backend routes (e.g. purchase-order update, purchase-annexe-charges, product-history) existed only as previously-generated code and were never actually described in openapi.yaml — pre-existing spec/code drift, invisible until codegen runs again.

**Why:** Regenerating from openapi.yaml to add a new feature's types silently deletes any generated export whose endpoint isn't in the spec, even if the frontend still imports and calls it. Typecheck alone caught this instantly (missing-export errors across several unrelated pages), but it could just as easily surface only at runtime.

**How to apply:** Before running `pnpm run codegen` in `lib/api-spec`, diff the generated files afterward against git HEAD and check every genuinely removed `export const/function` (not just reordered — grep-count each removed name in the new file) has a legitimate reason to be gone. If a removed export corresponds to a real route in `artifacts/api-server/src/routes/*.ts`, add that endpoint (and its schemas) to openapi.yaml before finishing, rather than leaving frontend pages broken or hand-patching the generated output (which the next codegen run would just re-break).
