#!/bin/sh
set -eu

# Use a container-local pnpm store to avoid Windows bind mount issues.
PNPM_STORE_DIR=/tmp/.pnpm-store
export PNPM_STORE_DIR
mkdir -p "$PNPM_STORE_DIR"

# Install pnpm (deterministic version)
npm i -g pnpm@10.19.0
pnpm -v

# Install workspace dependencies including dev packages for test tooling.
NODE_ENV=development pnpm -w install --no-frozen-lockfile --store-dir "$PNPM_STORE_DIR"

# Run tests for API package
pnpm --filter @autoassist/api run test
