#!/usr/bin/env bash
set -euo pipefail

# Install pnpm globally
npm i -g pnpm@10.19.0
pnpm -v

# Install workspace deps (no frozen to tolerate dev changes)
pnpm -w install --no-frozen-lockfile

# Generate Prisma client for API package
pnpm --filter @autoassist/api prisma generate

# Build API
pnpm --filter @autoassist/api build

# Start API
node dist/src/app.js
