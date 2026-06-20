---
name: GitHub push setup
description: How to push commits to GitHub from this Replit environment
---

**Working method:** use `listConnections('github')` in code_execution to get the access token, then embed it in the push URL:

```javascript
const conns = await listConnections('github');
const token = conns[0].settings.access_token;
const repoUrl = `https://x-access-token:${token}@github.com/boukadaabdelhamid-dot/midanic-monorepo.git`;
execSync(`git push "${repoUrl}" main`, { ... });
```

**Why:** The Replit GitHub integration injects the OAuth token into `listConnections('github')[0].settings.access_token`. This works for push. Use `x-access-token` as the username part of the URL.

**How to apply:** whenever git push is needed, use code_execution with listConnections to get the token dynamically — never store the token in any file.
