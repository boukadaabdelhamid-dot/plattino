---
name: Artifact vs legacy .replit workflow port conflicts
description: When a project is converted to Replit artifact services, old hand-authored .replit workflows for the same apps can keep running and squat the new artifact ports, causing public-preview 502s.
---

Registering artifact services (each gets `artifacts/<name>/.replit-artifact/artifact.toml` with its
own fixed `localPort`) does not automatically stop pre-existing hand-authored `.replit` workflows
for the same apps. If both exist, the public preview proxy routes by path to the artifact's declared
port, but that port may be unstarted/different from the legacy workflow's port — public domain 502s
while `127.0.0.1:<legacy-port>` still looks fine locally.

**Why:** artifact registration is additive; it doesn't prune old `[[workflows.workflow]]` entries in
`.replit`, and `removeWorkflow` on the legacy entry doesn't always kill an already-running child
process (e.g. a stray vite/node process can keep squatting the old port, or even the new port if PIDs
overlap) — you may need to manually `lsof -i:<port>` and `kill -9` leftovers after removing the
workflow.

**How to apply:** if a public `*.replit.dev` URL 502s right after artifacts are registered (or after
an import), diff the artifact.toml `localPort`s against any still-configured `.replit` workflows for
the same app. Remove the legacy workflows, verify with `lsof` that no stale process still holds a
relevant port, then restart the exact artifact-managed workflow names (e.g. `artifacts/erp: web`) —
per platform convention, never recreate/replace those with a hand-configured workflow.
