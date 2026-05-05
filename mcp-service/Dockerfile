# syntax=docker/dockerfile:1.6
#
# Hierarchia MCP service — production image for Railway.
# Multi-stage: build TypeScript, then ship a lean runtime image.
#
FROM node:22-alpine AS builder
WORKDIR /app

COPY package.json ./
# Use npm for the build stage so the image isn't tied to a specific
# Corepack version on Railway. Lockfile-free is fine here because the
# image is rebuilt from package.json on every push.
RUN npm install --no-audit --no-fund

COPY tsconfig.json ./
COPY index.ts ./
COPY supabase-tools.ts ./
COPY persistence.ts ./
COPY sliding-window.ts ./
RUN npx tsc -p tsconfig.json

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY --from=builder /app/dist ./dist

EXPOSE 3030

CMD ["node", "dist/index.js"]
