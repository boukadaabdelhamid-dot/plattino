---
name: Expo Go phone testing via tunnel
description: How to let a physical phone (Expo Go app) reach a Metro dev server running in this container, when the container has no public IP reachable by the phone off-network.
---

## Problem
Expo Go on a real phone needs a publicly reachable URL for both the manifest and the JS bundle. The default `expo start --tunnel` mode (bundled `@expo/ngrok`) is broken in this environment: it ships an ancient legacy ngrok v2.3.41 agent that fails almost every attempt with `CommandError: TypeError: Cannot read properties of undefined (reading 'body')`, even after configuring a real ngrok authtoken. Treat `--tunnel`/`@expo/ngrok` as non-functional here — don't spend time re-debugging it.

## Working approach
1. Install `cloudflared` as a system dependency (nix package, no account/token needed for a quick tunnel).
2. Run `cloudflared tunnel --url http://localhost:8081` (or whatever port Metro binds) to get a random `https://*.trycloudflare.com` public URL.
3. Set `EXPO_PACKAGER_PROXY_URL=<that url>` before `npx expo start` (no `--tunnel`, no `--web`). Expo CLI's `UrlCreator` gives this env var top priority over its own ngrok/tunnel/LAN logic, so the manifest and bundle URLs it prints/serves are rewritten to the tunnel domain.

## Critical gotcha: process lifetime
Background processes started with `&`, `nohup`, `setsid`, or `disown` inside a shell-tool call do **not** survive past that tool call in this sandbox — they get reaped even though those tricks normally detach from the parent. The only processes that persist across tool calls are ones supervised by Replit's own workflow system.

**How to apply:** wrap the cloudflared + expo start sequence in a single shell script and register it as its own dedicated workflow (console output type; separate from the app's main web-preview workflow) rather than trying to background it manually. The script should launch cloudflared, poll its log for the `trycloudflare.com` URL, export `EXPO_PACKAGER_PROXY_URL`, then `exec npx expo start` so Metro becomes the workflow's foreground process.

Caveat to tell the user: the quick-tunnel URL is random per run and dies when the workflow restarts/stops — they'll need a fresh URL each time they restart that workflow.
