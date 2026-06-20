---
name: Transfer movements double-count guard
description: Why a unified inventory timeline must exclude TR-prefixed inventory_movements when also showing stock_transfer_events.
---

# Inter-store transfers write stock TWICE in two systems

A received inter-store transfer records its stock impact in BOTH
`stock_transfer_events` (the full lifecycle) AND `inventory_movements` (a source
`out` + destination `in` at receive time, each tagged `reference = 'TR-{transferId}'`).

**Rule:** any feature that builds a unified product/stock timeline by merging
`inventory_movements` with `stock_transfer_events` MUST exclude the transfer-generated
movements, or the received transfer appears twice. Filter:
`reference IS NULL OR reference NOT LIKE 'TR-%'` (the NULL branch keeps manual
adjustments, whose reference is null).

**Why:** transfers are best represented by their lifecycle events; the `TR-`
inventory_movements are just the bookkeeping side-effect of the receive step and
would duplicate the "received" moment.
