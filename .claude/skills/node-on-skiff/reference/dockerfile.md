# Node.js Dockerfile for Skiff

Adapt this to the app; read the code first. It assumes npm, a `build` script that writes
`dist/`, and `dist/server.js` as the entry point. Swap the install line for the app's
package manager (`reference/frameworks.md`).

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build --if-present && npm prune --omit=dev

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production HOME=/tmp PORT=8080
COPY --from=build /app/package.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
USER 1000
EXPOSE 8080
CMD ["node", "dist/server.js"]
```

Why each line matters on Skiff:

- `npm ci` with the lockfile copied first: reproducible installs and a cached layer.
- Two stages: compilers and dev dependencies stay out of the runtime image.
- `HOME=/tmp`: the filesystem is read-only except `/tmp`; tools that write to `$HOME` fail
  otherwise.
- `USER 1000`: Skiff runs the container as UID 1000 whatever the image says. Files the app
  reads must be readable by that user; do not `chmod` them to owner-only.
- `CMD ["node", ...]` in exec form: Node gets SIGTERM directly. `npm start` adds a process
  in between and writes logs under `$HOME`.
- `PORT=8080` is a fallback for local runs; Skiff sets `PORT` itself. `EXPOSE` is only
  documentation, Skiff does not read it.

## Migrations on start

When the app has a database, run its migrations before the server, and `exec` the server so
it still receives SIGTERM:

```dockerfile
CMD ["sh", "-c", "npx prisma migrate deploy && exec node dist/server.js"]
```

Use the app's own migration command (`knex migrate:latest`, `npm run migrate`, and so on).
The migration tool must be in `dependencies`, since dev dependencies were pruned.

## Next.js standalone

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production HOME=/tmp
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
RUN rm -rf .next/cache && ln -s /tmp .next/cache
USER 1000
CMD ["sh", "-c", "HOSTNAME=0.0.0.0 exec node server.js"]
```

Drop the `public` line if the app has no `public/` folder; `COPY` of a missing path fails
the build.

## .dockerignore

```
node_modules
.git
.env
.env.local
dist
.next
coverage
```

Keep `.env.production` out of this list if the build reads non-secret values from it.
