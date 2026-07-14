---
name: Expo web workflow + baseUrl trap
description: How the Midanic mobile Expo app is served for preview, and a baseUrl pitfall to avoid if it's ever moved behind a path prefix.
---

The mobile companion app (`artifacts/mobile-app`) is not registered as a `.replit-artifact/artifact.toml` artifact (unlike erp/web-store) — no example of a "mobile"/Expo artifact kind exists, and `verifyAndReplaceArtifactToml` requires an already-existing `artifact.toml` (it's an edit tool, not a create tool), so a brand-new artifact.toml can't be created that way. It runs instead as a plain Replit workflow (`configureWorkflow`) on port 5000/webview: `EXPO_PUBLIC_API_URL=https://$REPLIT_DEV_DOMAIN:8080 pnpm --filter @workspace/mobile-app run web` (script runs `expo start --web --port 5000`).

**Why:** webview output type requires port 5000. Since the app is served at the domain root (not behind a path prefix like `/mobile/`), `app.json`'s `expo.experiments.baseUrl` must stay unset — setting it to `/mobile` breaks asset resolution when Metro serves from root.

**How to apply:** If this app is ever put behind a shared path-routed domain (like erp's `/erp/`), reinstate a matching `baseUrl` AND get it proxied at that path — don't set one without the other. `app.json`/`package.json` in this repo have CRLF line endings; exact-match string edits fail silently unless you account for `\r\n`.
