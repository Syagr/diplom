set -eu

PNPM_STORE_DIR=/tmp/.pnpm-store
export PNPM_STORE_DIR
mkdir -p "$PNPM_STORE_DIR"

npm i -g pnpm@10.19.0
pnpm -v

NODE_ENV=development pnpm -w install --no-frozen-lockfile --store-dir "$PNPM_STORE_DIR"
NODE_ENV=development pnpm --filter @autoassist/shared build

NODE_ENV=development pnpm --filter @autoassist/api exec prisma generate --schema /work/apps/api/prisma/schema.prisma

NODE_ENV=development pnpm --filter @autoassist/api worker:notify