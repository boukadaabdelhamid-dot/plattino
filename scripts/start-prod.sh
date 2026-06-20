#!/bin/bash
set -e
export PORT=8080
export NODE_ENV=production
exec node --enable-source-maps artifacts/api-server/dist/index.mjs
