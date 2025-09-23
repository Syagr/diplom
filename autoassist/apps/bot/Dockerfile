FROM node:20-alpine

WORKDIR /usr/src/app

# Enable pnpm
RUN corepack enable

# Copy package files
COPY package.json pnpm-lock.yaml ./

# Install dependencies
RUN pnpm install --frozen-lockfile

# Copy source code
COPY . .

# Build the app
RUN pnpm build

EXPOSE 3000

CMD ["pnpm", "start"]