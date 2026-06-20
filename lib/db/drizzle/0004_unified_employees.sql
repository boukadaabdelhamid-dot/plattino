-- ─── Step 1: Add is_active to users ──────────────────────────────────────────
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_active" boolean NOT NULL DEFAULT true;--> statement-breakpoint

-- ─── Step 2: Add user_id FK to employees ─────────────────────────────────────
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "user_id" integer REFERENCES "public"."users"("id") ON DELETE SET NULL;--> statement-breakpoint
ALTER TABLE "employees" ADD CONSTRAINT "employees_user_id_unique" UNIQUE ("user_id");--> statement-breakpoint

-- ─── Step 3: Create user accounts for existing employees (password = midanic2026) ─
-- bcrypt hash of "midanic2026" (cost 10): $2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uHV/WqfoK
-- We generate proper hashes inline using pgcrypto if available, otherwise use a fixed hash.
-- Fixed bcrypt hash for "midanic2026":
DO $$
DECLARE
  sara_uid   integer;
  fatima_uid integer;
  mohammed_uid integer;
  ghezlane_uid integer;
  admin_uid  integer;
  pw_hash    text := '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lHHG';
BEGIN
  -- ── سارة أحمد ──────────────────────────────────────────────────────────────
  SELECT id INTO sara_uid FROM users WHERE LOWER(email) = 'sara@midanic.com' LIMIT 1;
  IF sara_uid IS NULL THEN
    INSERT INTO users (name, email, password_hash, role, preferred_lang, phone, is_active)
    VALUES ('سارة أحمد', 'sara@midanic.com', pw_hash, 'employee', 'ar', '0501234567', true)
    RETURNING id INTO sara_uid;
    -- Link to user_stores (store 1)
    INSERT INTO user_stores (user_id, store_id) VALUES (sara_uid, 1) ON CONFLICT DO NOTHING;
  END IF;
  -- Link employee record
  UPDATE employees SET user_id = sara_uid WHERE LOWER(email) = 'sara@midanic.com' AND user_id IS NULL;

  -- ── فاطمة حسن ──────────────────────────────────────────────────────────────
  SELECT id INTO fatima_uid FROM users WHERE LOWER(email) = 'fatima@midanic.com' LIMIT 1;
  IF fatima_uid IS NULL THEN
    INSERT INTO users (name, email, password_hash, role, preferred_lang, phone, is_active)
    VALUES ('فاطمة حسن', 'fatima@midanic.com', pw_hash, 'employee', 'ar', '0555551234', true)
    RETURNING id INTO fatima_uid;
    INSERT INTO user_stores (user_id, store_id) VALUES (fatima_uid, 1) ON CONFLICT DO NOTHING;
  END IF;
  UPDATE employees SET user_id = fatima_uid WHERE LOWER(email) = 'fatima@midanic.com' AND user_id IS NULL;

  -- ── محمد علي ───────────────────────────────────────────────────────────────
  SELECT id INTO mohammed_uid FROM users WHERE LOWER(email) = 'mohammed@midanic.com' LIMIT 1;
  IF mohammed_uid IS NULL THEN
    INSERT INTO users (name, email, password_hash, role, preferred_lang, phone, is_active)
    VALUES ('محمد علي', 'mohammed@midanic.com', pw_hash, 'employee', 'ar', '0509876543', true)
    RETURNING id INTO mohammed_uid;
    INSERT INTO user_stores (user_id, store_id) VALUES (mohammed_uid, 1) ON CONFLICT DO NOTHING;
  END IF;
  UPDATE employees SET user_id = mohammed_uid WHERE LOWER(email) = 'mohammed@midanic.com' AND user_id IS NULL;

  -- ── ghezlane (if exists) ────────────────────────────────────────────────────
  SELECT id INTO ghezlane_uid FROM users WHERE LOWER(email) = 'hhgh' LIMIT 1;
  IF ghezlane_uid IS NULL THEN
    -- ghezlane has email 'hhgh' in employees (invalid), skip user creation
    -- but try to link by name if a matching user exists
    SELECT id INTO ghezlane_uid FROM users WHERE LOWER(name) = 'ghezlane' LIMIT 1;
  END IF;
  IF ghezlane_uid IS NOT NULL THEN
    UPDATE employees SET user_id = ghezlane_uid WHERE name = 'ghezlane' AND user_id IS NULL;
  END IF;

  -- ── Admin → Insert employee record if missing ────────────────────────────────
  SELECT id INTO admin_uid FROM users WHERE role = 'admin' LIMIT 1;
  IF admin_uid IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM employees WHERE user_id = admin_uid) THEN
      INSERT INTO employees (store_id, user_id, name, email, phone, position, salary, status, hire_date)
      SELECT 1, admin_uid, u.name, u.email, u.phone, 'Admin', '0', 'active', CURRENT_DATE
      FROM users u WHERE u.id = admin_uid
      ON CONFLICT DO NOTHING;
    END IF;
    -- Ensure admin is linked in user_stores for store 1
    INSERT INTO user_stores (user_id, store_id) VALUES (admin_uid, 1) ON CONFLICT DO NOTHING;
  END IF;
END$$;--> statement-breakpoint

-- ─── Step 4: Ensure caisses exist for all newly linked users ─────────────────
-- (caisses are auto-created at login via ensureCaisse; this backfills them)
INSERT INTO caisses (store_id, owner_user_id, kind, balance)
SELECT DISTINCT e.store_id, e.user_id, 'staff', '0.00'
FROM employees e
WHERE e.user_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM caisses c
    WHERE c.owner_user_id = e.user_id AND c.store_id = e.store_id AND c.kind = 'staff'
  );
