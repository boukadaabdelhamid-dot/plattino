-- Phase 1 fixes: cost_price archival on order_items + non-negative stock constraint
-- Applied via: pnpm --filter @workspace/db run push

-- Add cost_price snapshot column to order_items so COGS can be computed historically
ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "cost_price" numeric(10,2);

-- Prevent stock from going below zero at the database level
ALTER TABLE "products" ADD CONSTRAINT IF NOT EXISTS "stock_non_negative" CHECK (stock >= 0);
