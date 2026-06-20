---
name: Inline nullish array loop
description: Pattern that causes infinite setState loop — inline ?? [] in render used as useEffect dependency
---

**Rule:** Never use `(data?.items ?? [])` inline as a variable that feeds into `useEffect` deps or as a state initialiser inside a component.

**Why:** `?? []` creates a new array reference on every render. If that reference is in a `useEffect` dependency array, the effect fires on every render. If the effect calls `setState`, it triggers another render → infinite loop. React hits its 50-update limit and throws "Maximum update depth exceeded".

**How to apply:**
- Always wrap React Query–derived arrays in `useMemo`: `const items = useMemo(() => data?.items ?? [], [data]);`
- Move constant objects/arrays used as state initialisers to module-level constants (outside the component), not inside the function body.
- In Products.tsx this appeared as `refBrands`, `refColors`, `refFamilies` — fixed with `useMemo`.
- Also appeared as `emptyFilters` defined inside component — moved outside as `EMPTY_FILTERS`.
