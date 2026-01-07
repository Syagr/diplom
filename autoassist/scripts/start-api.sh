#!/bin/sh
set -eu

# Use a container-local pnpm store to avoid Windows bind mount issues.
PNPM_STORE_DIR=/tmp/.pnpm-store
export PNPM_STORE_DIR
mkdir -p "$PNPM_STORE_DIR"

# Install pnpm globally only if missing to avoid ENOTEMPTY on restart
if ! command -v pnpm >/dev/null 2>&1; then
	npm i -g pnpm@10.19.0
fi
pnpm -v

# Install workspace deps including dev packages for build tools.
NODE_ENV=development pnpm -w install --no-frozen-lockfile --store-dir "$PNPM_STORE_DIR"

# Build shared package for runtime imports.
NODE_ENV=development pnpm --filter @autoassist/shared build

# Generate Prisma client for API package
NODE_ENV=development pnpm --filter @autoassist/api exec prisma generate --schema /work/apps/api/prisma/schema.prisma

# Build API
NODE_ENV=development pnpm --filter @autoassist/api build

# Start API
node dist/src/app.js
