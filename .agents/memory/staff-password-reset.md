---
name: Staff password reset (ERP)
description: Admin-only staff password reset endpoint and its deliberate non-revocation of existing sessions.
---

# Staff password reset

Admin can reset any staff member's password via `PUT /erp/staff/:id/password`
(`authenticate + requireAdmin`): validates length >= 6, rejects `role==="customer"`
targets, 404 on missing, stores a fresh `bcrypt.hash(pw, 10)`. It never reads,
decrypts, or returns the existing password.

**Decision:** resetting a password does NOT revoke JWTs already issued to that
account — an existing logged-in session stays valid until the token expires.

**Why:** auth is stateless JWT with no token-version/session table; the reset
feature was scoped for routine admin password management, not compromise
recovery.

**How to apply:** if a future task needs "force logout on reset" or
compromise-recovery semantics, add a token-version (or session revocation) check
in `authenticate`; bumping it on password change is the lever. Don't assume reset
alone kicks out active sessions.
