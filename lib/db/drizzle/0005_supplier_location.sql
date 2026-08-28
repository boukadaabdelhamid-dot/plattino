-- Supplier-specific location fields used by the ERP supplier form.
-- Additive and nullable so existing supplier rows remain valid.
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "wilaya" text;--> statement-breakpoint
ALTER TABLE "suppliers" ADD COLUMN IF NOT EXISTS "commune" text;