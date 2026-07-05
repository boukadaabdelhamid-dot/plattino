---
name: Order payload empty-string field fallbacks
description: customer phone (and similar contact fields) can be stored as '' not null, so required-field fallbacks in order/draft payloads must use || / trim, not ??.
---

# Order payload empty-string field fallbacks

The API order-creation endpoint requires non-empty customerName, customerPhone,
customerAddress (`if (!customerName || !customerPhone || !customerAddress)` →
400). Customer/contact records can have a phone stored as an EMPTY STRING (''),
not null. A fallback written as `buyer.phone ?? "0000000000"` then sends ''
through — nullish coalescing only defaults on null/undefined — and the sale is
rejected with a 400. Use `buyer.phone?.trim() || "0000000000"` instead.

**Why:** a POS à-terme sale for a real linked customer with a blank phone failed
with HTTP 400 "customerName, customerPhone, customerAddress required" even though
a customer was selected (the credit/plafond check had already passed).

**How to apply:** any required-field fallback fed to order/draft creation must
treat '' as missing (`|| default`, ideally with `.trim()`), not just null
(`??`). The POS saveDraft path carries the same latent `?? "0000000000"`
pattern — fix it too if the drafts endpoint ever validates phone.
