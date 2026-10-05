# Medley: the built app + API (and, as a separate command, the background worker) in one small
# Node image. See docs/hosting.md.
#
#   docker build -t medley .                       (add --build-arg MEDLEY_ASSET_URL=… for a CDN)
#   docker run -p 32123:32123 -v medley-data:/data -v medley-config:/config medley
#   docker run -v medley-data:/data -v medley-config:/config medley node server/worker.ts

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# Optional: serve the hashed JS/CSS from a CDN (upload dist/assets/ there after building).
ARG MEDLEY_ASSET_URL=""
ENV MEDLEY_ASSET_URL=${MEDLEY_ASSET_URL}
RUN npm run build

# The server needs only Node built-ins at runtime (Node runs the TypeScript directly).
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=32123 \
    MEDLEY_DATA_DIR=/data \
    MEDLEY_CONFIG_DIR=/config
COPY --from=build /app/package.json ./
COPY --from=build /app/dist ./dist
COPY --from=build /app/server ./server
COPY --from=build /app/scripts ./scripts
COPY --from=build /app/src/data ./src/data
RUN mkdir -p /data /config && chown node:node /data /config
USER node
VOLUME ["/data", "/config"]
EXPOSE 32123
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://localhost:32123/healthz || exit 1
CMD ["node", "server/serve.ts"]
