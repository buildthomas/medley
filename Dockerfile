# Medley: the built app + API in one small Node image. See docs/hosting.md.
#
#   docker build -t medley .
#   docker run -p 8080:8080 -v medley-data:/data -v medley-config:/config -e MEDLEY_PASSWORD=… medley

FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# The server needs only Node built-ins at runtime (Node runs the TypeScript directly).
FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8080 \
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
EXPOSE 8080
HEALTHCHECK --interval=60s --timeout=5s CMD wget -qO- http://localhost:8080/healthz || exit 1
CMD ["node", "server/serve.ts"]
