#!/usr/bin/env bash
set -euo pipefail

# Install pnpm
npm i -g pnpm@10.19.0
pnpm -v

# Install workspace deps
pnpm -w install --no-frozen-lockfile

# Sync schema and generate client
pnpm --filter @autoassist/api exec prisma db push
pnpm --filter @autoassist/api exec prisma generate

# Seed database (best-effort)
pnpm --filter @autoassist/api exec tsx prisma/seed.ts || true
pnpm --filter @autoassist/api exec node ./scripts/seed-demo-orders.js || true

echo "Prisma db push + seed complete"
