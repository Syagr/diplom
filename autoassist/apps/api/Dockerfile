# This Dockerfile builds the API using the pnpm monorepo (apps, packages)
# Build with context at repo root: docker build -f apps/api/Dockerfile . -t autoassist-api

# -------------------------------------------------------
# Base: enable pnpm once to reuse in all stages
# -------------------------------------------------------
FROM node:20-bullseye-slim AS base
ENV PNPM_HOME=/root/.local/share/pnpm \
  PATH="$PNPM_HOME:$PATH" \
  CI=true \
  PRISMA_SCHEMA=prisma/schema.prisma
RUN corepack enable && corepack prepare pnpm@9.0.0 --activate
WORKDIR /app

# -------------------------------------------------------
# deps: install workspace deps with lockfile
# -------------------------------------------------------
FROM base AS deps

# Tools needed for native builds (sharp, bcrypt, etc.)
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

# Copy only manifests for better layer caching
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY apps/api/package.json apps/api/
COPY packages/shared/package.json packages/shared/
COPY packages/config/package.json packages/config/

# Install all workspace deps (keeps store local to the image)
RUN pnpm install --frozen-lockfile

# -------------------------------------------------------
# builder: copy sources, build, prisma generate, strip dev deps
# -------------------------------------------------------
FROM deps AS builder
COPY . .

# Build shared lib first, then API
RUN pnpm --filter @autoassist/shared build
# Generate Prisma client in API package (cwd inside package)
RUN cd apps/api && pnpm prisma generate --schema=prisma/schema.prisma
RUN pnpm --filter @autoassist/api build

# Produce a deployable folder with only prod deps for the API
RUN pnpm deploy --filter @autoassist/api --prod /app/deploy

# Copy prisma schema/assets into the deploy folder for client generation
RUN mkdir -p /app/deploy/prisma && cp -r apps/api/prisma/* /app/deploy/prisma/

# Regenerate Prisma client against the prod node_modules inside deploy (deploy wipes the generated client)
RUN cd /app/deploy && pnpm dlx prisma@5.22.0 generate --schema=$PRISMA_SCHEMA

# -------------------------------------------------------
# runtime: minimal image with built assets + prod deps
# -------------------------------------------------------
FROM node:20-bullseye-slim AS runtime

ENV NODE_ENV=production \
    PNPM_HOME=/root/.local/share/pnpm \
    PATH="$PNPM_HOME:$PATH"

# Proper signal handling
RUN apt-get update && apt-get install -y --no-install-recommends dumb-init \
  && rm -rf /var/lib/apt/lists/*

# Non-root user
RUN groupadd -g 1001 nodejs && useradd -u 1001 -g 1001 -m autoassist

WORKDIR /app

# Copy the deploy output
COPY --from=builder --chown=autoassist:nodejs /app/deploy/ .

USER autoassist

EXPOSE 3001

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3001/health', r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

# Optional migrations on start
ENV RUN_MIGRATIONS=false
ENTRYPOINT ["dumb-init", "--"]
CMD ["/bin/sh", "-c", "if [ \"$RUN_MIGRATIONS\" = \"true\" ]; then npx prisma migrate deploy; fi; node dist/src/app.js"]
