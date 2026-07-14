---
name: New staff accounts start with zero permissions
description: A freshly-created employee via /erp/staff has no module permissions at all; blank-screen/403 bugs during manual or agent testing are often just missing permission setup, not app bugs.
---

Creating a new staff user (e.g. via `POST /erp/staff` as admin) does not grant
any default module permissions. The new user can log in and select a store,
but every permission-gated list endpoint (`caisse:view`, `accounting:view`,
etc.) returns 403 until an admin explicitly grants permissions via
`PUT /erp/permissions/:userId`.

**Why:** matches real production behavior (permissions are opt-in per
employee) — this is intentional, not a setup bug in the app.

**How to apply:** when standing up a throwaway non-admin test user for manual
or agent-driven QA, immediately grant the specific section permissions the
test needs (e.g. `{"caisse":["view","create","edit"],"accounting":["view","create"]}`)
before investigating a "blank screen" or 403 as an app bug — check permissions
first.
