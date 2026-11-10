# Node.js framework notes

Every framework below must listen on `process.env.PORT` on `0.0.0.0`, start with `node`
from built output, and write only to `/tmp`.

## Express

```js
const port = Number(process.env.PORT ?? 8080);
const server = app.listen(port, '0.0.0.0', () => console.log(`listening on ${port}`));
process.on('SIGTERM', () => server.close(() => process.exit(0)));
```

TypeScript: compile with `tsc` in the build stage and start `node dist/server.js`. Never
run `ts-node` or `tsx` in production.

## Fastify

Fastify binds to `localhost` by default. Pass the host:

```js
await app.listen({ port: Number(process.env.PORT ?? 8080), host: '0.0.0.0' });
process.on('SIGTERM', () => app.close().then(() => process.exit(0)));
```

## NestJS

In `main.ts`:

```ts
const app = await NestFactory.create(AppModule);
app.enableShutdownHooks();
await app.listen(Number(process.env.PORT ?? 8080), '0.0.0.0');
```

Build with `nest build` (or `npm run build`); start with `node dist/main.js`.

## Next.js

- Build with `next build`; start with `next start -H 0.0.0.0 -p $PORT`, or, with
  `output: 'standalone'` in `next.config.js`, `node server.js` from `.next/standalone`.
  Standalone binds to `HOSTNAME`, which the pod sets to its own name, so set it in the
  command: `CMD ["sh", "-c", "HOSTNAME=0.0.0.0 exec node server.js"]`.
- `next start` and image optimisation write to `.next/cache`, which is read-only on Skiff.
  Point it at `/tmp` in the runtime stage:

  ```dockerfile
  RUN rm -rf .next/cache && ln -s /tmp .next/cache
  ```
- `NEXT_PUBLIC_*` values are baked in at build time, and Skiff has no build arguments. Put
  them in a committed `.env.production` file if they are not secret, or read them at
  runtime on the server.
- Standalone output does not copy `public/` or `.next/static`; copy both next to
  `server.js` in the Dockerfile.

## Vite, Create React App and other static frontends

A frontend that builds to static files has no Node server. Serve the built folder with a
small web server on port 8080; see the `dockerfile-for-skiff` skill's static template. Values
the browser needs are baked in at build time, so commit non-secret ones in a `.env.production`.

## Package managers

| Lockfile | Install in the build stage |
| --- | --- |
| `package-lock.json` | `npm ci` |
| `pnpm-lock.yaml` | `corepack enable && pnpm install --frozen-lockfile` |
| `yarn.lock` (Yarn 1) | `yarn install --frozen-lockfile` |
| `yarn.lock` (Yarn 2+) | `corepack enable && yarn install --immutable` |

No lockfile: generate one locally, commit it, then build. A missing lockfile is a common
build failure.

Prune for the runtime stage with `npm prune --omit=dev` (or install with `--prod`), so
build tools stay out of the image.

## Node.js version

Match the version the app was tested on: `engines.node`, `.nvmrc` or `.node-version`. Use
the same major in the Dockerfile's `FROM node:<major>-slim`. Do not use an end-of-life
major.

## Common runtime errors

| The log says | Fix |
| --- | --- |
| `EADDRINUSE` or listening on `127.0.0.1` | Bind `0.0.0.0` on `PORT` |
| `EACCES: permission denied, open '/app/...'` or `EROFS` | Write to `/tmp` instead |
| `EACCES ... mkdir '/home/node/.npm'` | Set `ENV HOME=/tmp`, start with `node`, not `npm` |
| `Cannot find module` | A runtime dependency is in `devDependencies`, or the build output was not copied |
| `listen EACCES: permission denied 0.0.0.0:80` | Ports below 1024 are refused; use `PORT` (8080) |
