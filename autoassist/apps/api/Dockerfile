# -------------------------------------------------------
# Base: enable pnpm once to reuse in all stages
# -------------------------------------------------------
FROM node:18-bullseye-slim AS base
WORKDIR /app
ENV CI=true
# enable pnpm
RUN corepack enable && corepack prepare pnpm@^9.0.0 --activate

# -------------------------------------------------------
# Builder: install deps, build, prisma generate
# -------------------------------------------------------
FROM base AS builder

# Install build tooling (for native deps if any)
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Only copy files required to resolve deps first (better layer caching)
COPY package.json pnpm-lock.yaml* tsconfig.json ./
# if you have a workspace monorepo, also copy pnpm-workspace.yaml
# COPY pnpm-workspace.yaml ./

# Install all deps (dev + prod) for build
RUN pnpm install --frozen-lockfile

# Copy sources
COPY src ./src
COPY assets ./assets
COPY prisma ./prisma

# Generate Prisma client
RUN pnpm prisma generate

# Build
RUN pnpm build

# Prune dev deps to slim prod node_modules
RUN pnpm prune --prod

# -------------------------------------------------------
# Runtime: small image with only runtime bits
# -------------------------------------------------------
FROM base AS runtime

# Install dumb-init for proper signal handling
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init \
  && rm -rf /var/lib/apt/lists/*

# Create non-root user
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g 1001 -m autoassist

ENV NODE_ENV=production
WORKDIR /app

# Copy built app + prod node_modules + prisma schema
COPY --from=builder --chown=autoassist:nodejs /app/dist ./dist
COPY --from=builder --chown=autoassist:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=autoassist:nodejs /app/package.json ./package.json
COPY --from=builder --chown=autoassist:nodejs /app/prisma ./prisma
COPY --from=builder --chown=autoassist:nodejs /app/assets ./assets

USER autoassist

EXPOSE 3001

# Health check hits your /health endpoint
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Optional: run migrations on start (no-op if not using Prisma Migrate in prod)
# set RUN_MIGRATIONS=true to enable
ENV RUN_MIGRATIONS=false
ENTRYPOINT ["dumb-init", "--"]
CMD ["/bin/sh", "-c", "if [ \"$RUN_MIGRATIONS\" = \"true\" ]; then npx prisma migrate deploy; fi; node dist/app.js"]
