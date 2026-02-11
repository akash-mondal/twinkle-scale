# Stage 1: Install deps
FROM node:22-slim AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
RUN npm install --production=false

# Stage 2: Build TypeScript
FROM deps AS build
COPY . .
RUN npx tsc || true

# Stage 3: Production runtime
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
RUN apt-get update && apt-get install -y curl && rm -rf /var/lib/apt/lists/*
COPY --from=deps /app/node_modules node_modules/
COPY --from=build /app/dist dist/
COPY --from=build /app/data data/
COPY package.json ./
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s CMD curl -f http://localhost:3001/api/health || exit 1
CMD ["node", "dist/src/server/index.js"]
