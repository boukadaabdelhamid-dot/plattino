---
name: Caisse session/movement actions are ownership-gated, not just permission-gated
description: The caisse module's write actions require BOTH a permission string AND ownership/role checks; a permission alone doesn't grant access, and the main caisse is invisible to non-admin staff.
---

`GET /erp/caisses` returns different result sets depending on role, despite an
identical `caisse:view` permission check: admins get every caisse (main + all
staff); non-admin staff get ONLY their own staff caisse — the main caisse row
is never included for them. Session open/close and the "send transfer" action
similarly require ownership (`isMine || isAdmin`) on top of the granular
`caisse:create`/`caisse:edit`/`caisse:view` permission — holding the
permission string is necessary but not sufficient.

**Why:** caisses are modeled as strictly ownership-scoped for staff (mirrors
the canonical web ERP's `Caisse.tsx`, which derives `mainCaisse` from the same
list and simply hides the "Caisse principale" card + disables "send to main"
when the list has no main-kind row for that user) — this is intentional
product behavior, not a bug, even though it means a non-admin employee cannot
see the main caisse's balance or open its detail (`canSeeCaisse` denies
non-admins on any caisse with `ownerUserId !== self`, and main's
`ownerUserId` is `null`).

**How to apply:** when building any UI (mobile or web) against
`/erp/caisses*`, never assume the list includes the main caisse for
non-admins. A non-admin CAN still send a transfer with
`recipientCaisseId = <mainCaisseId>` (the POST endpoint allows any staff to
target main by id — only the `senderCaisseId` override, i.e. sending *from*
main, is admin-only) — but the UI needs the main caisse's id from elsewhere
(e.g. `GET /erp/account/me`'s `mainCaisseId` field) since the list won't
surface it. Admin's manual `admin/deposit` and `admin/withdraw` endpoints
move money staff→main and main→staff respectively (deposit = *to* main,
withdraw = *from* main) — there is no staff-facing equivalent for either.
