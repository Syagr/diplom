#!/bin/sh
set -eu

# Use a container-local pnpm store to avoid Windows bind mount issues.
PNPM_STORE_DIR=/tmp/.pnpm-store
export PNPM_STORE_DIR
mkdir -p "$PNPM_STORE_DIR"

# Install pnpm
npm i -g pnpm@10.19.0
pnpm -v

# Install workspace deps including dev packages for Prisma tooling.
NODE_ENV=development pnpm -w install --no-frozen-lockfile --store-dir "$PNPM_STORE_DIR"

# Sync schema and generate client
NODE_ENV=development pnpm --filter @autoassist/api exec prisma db push --schema /work/apps/api/prisma/schema.prisma
NODE_ENV=development pnpm --filter @autoassist/api exec prisma generate --schema /work/apps/api/prisma/schema.prisma

# Seed database (best-effort)
NODE_ENV=development pnpm --filter @autoassist/api exec tsx prisma/seed.ts || true
NODE_ENV=development pnpm --filter @autoassist/api exec node ./scripts/seed-demo-orders.js || true

echo "Prisma db push + seed complete"
