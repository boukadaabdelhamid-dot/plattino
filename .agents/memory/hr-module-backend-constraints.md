---
name: HR module (employees/attendance/leaves) backend constraints
description: Non-obvious gaps between the generated API types/hooks and what the ERP backend actually supports for employees, attendance, and leaves.
---

- Attendance has only GET/POST (`/erp/attendance`) — there is no update endpoint. A "check-in" and a later "check-out" for the same employee/day cannot patch one record; each must be a separate `useCreateAttendance` call, producing two rows for that day (one with `checkIn` set, one with `checkOut` set). Any future attendance UI or report must treat rows as events, not as one mutable per-day record, unless a PUT endpoint is added.

**Why:** confirmed by reading `artifacts/api-server/src/routes/erp.ts` (attendance section) and via curl — POST-only, no PUT/DELETE.

- `useUpdateEmployee`'s generated body type (`CreateEmployeeRequest`) has no `status` field, but the backend's `PUT /erp/employees/:id` handler reads and applies `status` from the raw body anyway (also flips the linked user's `isActive`). The web ERP bypasses this with `as unknown as Parameters<...>["data"]`; the mobile employee edit form does the same. Generated DTOs for this backend are not a reliable upper bound on accepted fields — check the actual route handler before assuming a field is unsupported.

**Why:** confirmed via `grep` on the route handler body destructuring vs the OpenAPI-generated `CreateEmployeeRequest`/`Employee` schema, and verified live with curl (partial `{"status":"inactive"}` PUT body was accepted and correctly flipped `isActive`).

- `EmployeeStatus` valid values are only `active | inactive | on_leave` (pgEnum `employee_status`). The web ERP UI references a `"terminated"` status that isn't a real enum value anywhere (dead/unused code) — don't mirror it.

- Leave type valid values are only `annual | sick | unpaid | other` (pgEnum `leave_type`). The web ERP UI offers an `"emergency"` option that isn't a real enum value — don't mirror it either.

**How to apply:** when extending HR features (employees/attendance/leaves) on any client, trust `lib/db/src/schema/erp.ts` pgEnums and the route handler bodies over the web ERP's UI options or the orval-generated request types.
