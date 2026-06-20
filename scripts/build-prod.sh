#!/bin/bash
set -e

echo "[build-prod] Building web store (BASE_PATH=/)..."
BASE_PATH=/ pnpm --filter @workspace/web-store run build

echo "[build-prod] Building ERP (BASE_PATH=/erp)..."
BASE_PATH=/erp pnpm --filter @workspace/erp run build

echo "[build-prod] Building API server..."
pnpm --filter @workspace/api-server run build

echo "[build-prod] Done."
