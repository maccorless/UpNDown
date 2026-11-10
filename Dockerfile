# One image runs the game server and serves the built client from the same origin.
FROM node:22-slim AS build
WORKDIR /app
COPY . .
RUN npm ci
RUN npm run build:server && npm run build:client && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production HOME=/tmp PORT=8080 CLIENT_DIST_DIR=/app/apps/client/dist
COPY --from=build /app /app
USER 1000
EXPOSE 8080
CMD ["node", "apps/server/dist/apps/server/src/index.js"]
