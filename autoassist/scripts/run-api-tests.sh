#!/usr/bin/env bash
set -euo pipefail

# Install pnpm (deterministic version)
npm i -g pnpm@10.19.0
pnpm -v

# Install workspace dependencies
pnpm -w install --no-frozen-lockfile

# Run tests for API package
pnpm --filter @autoassist/api run test
