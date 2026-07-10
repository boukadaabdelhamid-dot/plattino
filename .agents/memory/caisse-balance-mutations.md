---
name: caisse balance mutations
description: caisses need no advisory locks (global, no cross-store sync); use lockCaissesById for any multi-caisse mutation to avoid lock-order deadlocks.
---

Caisses are global (no per-store/cross-store balance sync like customers/
suppliers), so a plain row lock (`SELECT ... FOR UPDATE`) is sufficient — no
advisory lock is needed for a single-caisse mutation (`applyCaisseDelta` in
`balance-sync.ts` covers this).

**Why:** any endpoint that moves money between TWO caisses (e.g. admin
deposit staff→main vs admin withdraw main→staff) must not lock them
"source-then-destination" independently at each call site — deposit and
withdraw move the same pair in opposite logical directions, so opposite
lock order under concurrency is a real deadlock, not a theoretical one.

**How to apply:** for any mutation touching 2+ caisses in the same
transaction, use `lockCaissesById(tx, [idA, idB])` (locks via a single
`WHERE id IN (...) ORDER BY id FOR UPDATE`, so physical lock order is always
ascending-id regardless of call-site argument order) instead of two separate
single-row locks/`applyCaisseDelta` calls.
