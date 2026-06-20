# Midanic (ميدانيك) — Beauty & Grooming Platform

## Overview

pnpm workspace monorepo. Full-stack bilingual (AR/EN) beauty brand platform: web store + ERP management dashboard + Express API + Expo mobile app.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod, drizzle-zod
- **API codegen**: Orval (OpenAPI → React hooks + Zod schemas)
- **Frontend**: React 18 + Vite + TailwindCSS v4 + shadcn/ui
- **Mobile**: Expo (React Native)
- **Charts**: Recharts

## Brand

- Primary navy: `#1B3057` (HSL 219 53% 22%)
- Off-white: `#F5F5F0` (HSL 60 14% 95%)
- Logo: `attached_assets/logo_des_13_midanic_1777739613232.jpeg`
- Bilingual AR/EN throughout all UIs

## Artifacts

| Artifact | Path | Port | Description |
|---|---|---|---|
| `artifacts/api-server` | `/api/` | 8080 | Express REST API + WebSocket |
| `artifacts/web-store` | `/` | dynamic | Customer-facing e-commerce store (React+Vite) |
| `artifacts/erp` | `/erp/` | dynamic | Internal ERP management dashboard (React+Vite) |
| `artifacts/mobile-store` | `/mobile/` | dynamic | Customer mobile app (Expo) |

## Key Packages

| Package | Description |
|---|---|
| `lib/api-spec` | OpenAPI spec (`openapi.yaml`) + Orval codegen config |
| `lib/api-zod` | Generated Zod schemas (from `lib/api-spec`) |
| `lib/api-client-react` | Generated React Query hooks (from `lib/api-spec`) |
| `lib/db` | Drizzle schema + DB connection |

## Key Commands

- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks + Zod schemas
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run dev` — run API server locally

## Auth

- JWT stored in `localStorage` as `midanic_token`
- Admin credentials: `admin@midanic.com` / `admin1234`
- ERP and web store both use `setAuthTokenGetter(() => localStorage.getItem("midanic_token"))` from `@workspace/api-client-react`
- `use-auth.tsx` in web-store has `// @refresh reset` at top — keep this to avoid HMR context loss

## API Structure

- `artifacts/api-server/src/routes/` — route handlers
  - `auth.ts` — login, register, /me
  - `products.ts` — CRUD + reviews
  - `cart.ts` — cart management (returns `CartItem[]` array directly)
  - `orders.ts` — orders, admin orders, status update
  - `erp.ts` — employees, attendance, leaves, suppliers, purchase orders, inventory, accounting, CRM
  - `storage.ts` — file upload via object storage
- `artifacts/api-server/src/lib/ws.ts` — WebSocket server at `/ws` path
  - Broadcasts: `new_order`, `low_stock`, `leave_status_changed`, `purchase_received`

## Cart API Note

`useGetCart()` returns `CartItem[]` (array directly, not `{ items: CartItem[] }`). When using cart data:
```ts
const items = cart ?? [];
```

## Products API Note

`useGetProducts()` returns `ProductsResponse` which has shape `{ products: Product[], total: number }` (key is `products`, not `items`).

## Database Seed

- 4 categories, 16 products, 1 admin user, 2 coupons
- Admin: `admin@midanic.com` / `admin1234`

## Payment & Checkout

- **COD-only**: All checkout flows (web + mobile) are cash-on-delivery only
- Stripe and Twilio have been fully removed — do NOT re-add them
- No payment secrets required

## ERP Management System

All 11 modules fully implemented at `/erp/`:

| Module | Route | Features |
|---|---|---|
| Dashboard | `/erp/dashboard` | KPIs, daily sales chart, top products, financial overview |
| Orders | `/erp/orders` | List all orders, update status inline |
| Products | `/erp/products` | Full CRUD, bilingual name/description, category, stock |
| Employees | `/erp/employees` | CRUD, status badges (active/inactive/on_leave/terminated) |
| Attendance | `/erp/attendance` | Record check-in/out per employee per day |
| Leaves | `/erp/leaves` | Request leave, approve/reject with WS broadcast |
| Suppliers | `/erp/suppliers` | CRUD supplier network |
| Purchase Orders | `/erp/purchase-orders` | Create POs with line items, mark received (updates stock + WS) |
| Inventory | `/erp/inventory` | Stock movement log, manual adjustments |
| Accounting | `/erp/accounting` | Income/expense transactions, financial summary |
| Customers | `/erp/customers` | CRM — view order history, add notes |

## Mobile Notifications (WebSocket)

`artifacts/mobile-store/context/NotificationsContext.tsx` handles 4 event types for admin users:
- `new_order` — new customer order placed
- `low_stock` — product stock below threshold
- `purchase_received` — PO received (enriched with supplier name + total)
- `leave_status_changed` — leave approved/rejected (enriched with employee name + type)

Admin sees notifications tab instead of orders tab (bell icon with badge count).

## CSS Variables

Space-separated HSL values (no `hsl()` wrapper in `:root`):
```css
:root { --primary: 219 53% 22%; }
```
Usage: `background-color: hsl(var(--primary));`

## Employee Fields

Employees have `name` (not `nameEn`/`nameAr`). Products have `nameEn`/`nameAr`.
