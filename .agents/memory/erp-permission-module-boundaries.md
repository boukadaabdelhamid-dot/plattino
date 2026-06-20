---
name: ERP permission module boundaries
description: Which ERP endpoints belong to a permission-gated module vs. the all-staff personal "Mon Compte" page, and why realtime is page-gated only.
---

The ERP permission system is module-based: each of the Home-page modules is an independent `section` checked by `requirePermission(section, action)` (admins bypass; employees need a `granted=true` row in `user_permissions`). "view" disabled ⇒ hidden from Home + Sidebar + route-blocked + API-blocked.

## Caisse transfers belong to Mon Compte, NOT the Caisse module
The caisse-transfer endpoints — `GET /erp/caisse-transfers`, `POST /erp/caisse-transfers` (send), `.../accept|reject|cancel`, `GET /erp/caisse-transfer-recipients`, and `GET /erp/account/me` — must stay `requireStaff` (no `requirePermission`). They are consumed by **both** the Caisse module page (`Caisse.tsx`, route-gated `caisse:view`) **and** the all-staff personal page `MonCompte.tsx` (sidebar `/mon-compte` has NO section → every staff member).

**Why:** these are personal money operations guarded by participant checks (sender = current user; only sender/recipient can act). Gating them on `caisse` breaks Mon Compte (a staff member would see their balance + Send button but get 403). A code review flagged them as a "caisse API-blocking gap" — that is wrong because it lacked MonCompte context.

**How to apply:** the Caisse *module's* exclusive surface that SHOULD be `caisse`-gated is `/erp/caisses`, `/erp/caisses/:id`, `/erp/caisses/:id/sessions|open-session|close-session`, and the POS draft routes (`/erp/pos/drafts*`). Admin-only caisse ops (`/erp/caisses/admin/deposit|withdraw|adjust`, `/erp/caisses/reports`) stay `requireAdmin`.

## Realtime is page-gated only
The `realtime` module permission gates only the RealTime page (route + sidebar + Home tile). There is NO dedicated realtime REST endpoint — `RealTime.tsx` reuses `useGetAdminOrders` (orders perm) + `useGetAnalytics`. Do NOT gate the WebSocket connection on `realtime:view`: the WS is shared cross-module infrastructure (online-orders badge, low_stock, leave/purchase notifications), so gating it would break other modules for users who lack realtime but have orders/etc.

## Section split summary
- caisse split out of orders; suppliers split out of purchases.
- purchase-orders stays `purchases`; `/admin/orders` + retours stay `orders`.
- employees / attendance / leaves / accounting (transactions + accounting-summary) moved from `requireAdmin` to `requireStaff + requirePermission(section, action)`.

## Multi-store employees (added later)
Employees may now be assigned to multiple stores (same as admins). Three constraints were removed:
- `POST /auth/select-store` — customer guard only (employees can now switch stores)
- `POST /erp/staff` — removed `employee && storeIds.length > 1` rejection
- `PUT /erp/staff/:id/stores` — same removal
- `Staff.tsx` UI — checkboxes for all roles (was radio/single-select for employees)

Caisse stays global per user (`owner_user_id` unique, `store_id = NULL`). Switching stores does NOT create a new caisse — verified: same `caisse.id` and same `balance` across Store 1 and Store 2 for the same employee.
