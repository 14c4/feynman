# One production Node server: serves the built React app from dist/ and the API under /api/*.
# Build: docker build -t feynman .   Run: docker run -p 3001:3001 -e PORT=3001 feynman

FROM node:22-bookworm-slim AS build
WORKDIR /app
# Install with devDependencies (TypeScript, Vite) for the build; NODE_ENV is deliberately unset here.
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm prune --omit=dev --no-audit --no-fund

FROM node:22-bookworm-slim
WORKDIR /app
# The Presage SmartSpectra native runtime verifies the API key over HTTPS using the system CA store.
# The slim image has none (Node bundles its own CAs, the native library does not), so without this
# every Presage window fails with "Usage verification failed. Status code: 0" / a network error.
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production HOST=0.0.0.0
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/shared ./shared
USER node
# Railway injects PORT; the server falls back to 3001 locally.
CMD ["npm", "start"]
