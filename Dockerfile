# One image runs the game server and serves the built client from the same origin.
# The base image is pinned by digest so a rebuild cannot change it. To update: docker buildx imagetools inspect node:22-slim

FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build:server && npm run build:client && npm prune --omit=dev

FROM node:22-slim@sha256:e9f565d32859f0cbfb52125eafe8be39390f24dac302dc3cdf566e8ba3ab21ee
WORKDIR /app
ENV NODE_ENV=production HOME=/tmp PORT=8080 CLIENT_DIST_DIR=/app/apps/client/dist
COPY --from=build /app /app
USER 1000
EXPOSE 8080
CMD ["node", "apps/server/dist/apps/server/src/index.js"]
