---
name: Node.js apps on Skiff
description: Use when the user wants their own Node.js app (Express, Fastify, NestJS, Next.js or plain Node) to build and run on Skiff, or a Node.js app on Skiff fails to build or start.
summary: Gets a Node.js app ready for Skiff, so it listens on the port Skiff gives it, builds from its lockfile and starts with one command.
version: 1.1.0
tags:
  - node
  - javascript
  - typescript
  - express
  - nextjs
  - deploy
  - getting-started
targets: [claude, codex, cursor, generic]
author: Platform team
category: get-running
why: >
  Most first deploys of a Node.js app fail for the same few reasons: the app listens on a
  hard-coded port or on localhost, the start script runs a dev server, the build ignores the
  lockfile, or the app writes to its own folder, which is read-only on Skiff. This skill fixes
  those in the code and the Dockerfile before Skiff ever builds the app.
outcomes:
  - Make the app listen on the PORT Skiff gives it, on 0.0.0.0
  - Set one production start command that needs no dev tools
  - Build from the lockfile with npm ci, pnpm or yarn
  - Write a Dockerfile that runs as user 1000 and writes only to /tmp
  - Deploy it and check it answers on its Skiff address
asks:
  - Get this Express API ready to deploy on Skiff
  - Why does my Next.js app crash on start on Skiff?
  - Deploy my Fastify service to Skiff
prerequisites:
  - A Node.js app in a Git repository or a local folder
  - A package.json with its lockfile committed
---

# Node.js apps on Skiff

Use this skill when the user wants their own Node.js app to build and run on Skiff, or a
Node.js app they deployed fails to build or start. It covers the code changes, the
Dockerfile and the first deploy. It is not for operating Skiff itself. For a deploy that has
already failed, the `fix-a-failed-deploy` skill finds the cause first; for a database, the
`postgres-in-your-app` skill.

## The runtime contract

Skiff runs the image with these rules. The app must meet every one:

- Listen on `process.env.PORT`, bound to `0.0.0.0`. Skiff sets `PORT` to the component's
  `targetPort`, 8080 by default. Ports below 1024 are refused. `EXPOSE` in the Dockerfile is
  not read.
- Start listening within 10 minutes. Health checks are TCP connects on the port, not an
  HTTP path: an open port counts as healthy.
- The filesystem is read-only except `/tmp` (256Mi). The app runs as UID 1000.
- On stop, Skiff sends SIGTERM and kills the process 30 seconds later.
- Log to stdout and stderr, not to files.

## Work in this order

1. **Read the app.** Find `package.json`, the lockfile (`package-lock.json`,
   `pnpm-lock.yaml` or `yarn.lock`), `engines.node`, the framework, the build script and the
   start script. Find every `listen(` call and every write to disk. Note the environment
   variables it reads.
2. **Fix the port and host.** The server listens on `PORT` with 8080 as the fallback:

   ```js
   const port = Number(process.env.PORT ?? 8080);
   app.listen(port, '0.0.0.0', () => console.log(`listening on ${port}`));
   ```

   Framework specifics are in `reference/frameworks.md`.
3. **Make `start` production-only.** `start` runs built output with `node`, never `nodemon`,
   `ts-node`, `vite` or `next dev`. Anything it needs at runtime goes in `dependencies`, not
   `devDependencies`.
4. **Handle SIGTERM.** Node as the container's first process ignores SIGTERM unless the
   code handles it, so it is killed after 30 seconds. Close the server and exit:

   ```js
   process.on('SIGTERM', () => server.close(() => process.exit(0)));
   ```
5. **Move writes to /tmp.** Uploads, caches, SQLite files and generated files go under
   `/tmp` or out of the app. `/tmp` is emptied on every restart, so nothing durable lives
   there.
6. **Write the Dockerfile.** Use `reference/dockerfile.md`. It builds with the lockfile,
   runs as user 1000, sets `HOME=/tmp` and starts with `node`, not `npm start`. Name the file
   `Dockerfile` in the app's root directory. If Docker is installed locally, run
   `docker build` first.
7. **Get the Dockerfile into the source.** Follow the Skiff guide's `deploying` topic: for a
   GitHub repository, commit on a new branch, open a pull request, and merge only on the
   user's yes; for an upload, put it in the folder before `upload_source`.
8. **Add the component.** `get_project` (or `create_project`). For a repository,
   `detect_build` on it, then `add_component` with kind `repo`. For an upload, skip
   `detect_build`: `upload_source`, send the folder, then `add_component` with kind `upload`,
   its `uploadId`. Either way pass
   `generateDomain: true` and `deploy: true`. Leave
   `targetPort` at its default 8080 unless the app cannot read `PORT`; it cannot be changed
   through MCP after creation. Pass `rootDir` for an app in a subfolder of a monorepo: the
   build sees only that folder.
9. **Set variables.** Settings the app reads go in with `set_variables` (`set` as a list of
   `{key, value}`), secrets with `set_secrets`. Names `PORT`, `HOME`, `PATH`, `HOSTNAME` and
   the prefixes `DGP_` and `SKIFF_` are reserved. A variable change applies on `deploy` with
   mode `redeploy`.
10. **Poll and verify.** Call `get_project` until the deployment is `active`, `failed` or
    `crashed`; never call `deploy` again while it builds. Then `verify_deployment`.
11. **Fix and repeat.** On a failure, load `fix-a-failed-deploy` or read the guide's
    `troubleshooting` topic, fix the cause, deploy again.

## Done when

- `verify_deployment` says `reachable`.
- The URL `get_project` reports for the component answers the app's own page or route. Use
  that URL as given; do not assume `https`.

## Known issues

- Right after `add_component` with `deploy: true`, `verify_deployment` may say the
  component was never deployed. Check `list_deployments` first; if one is `building`, wait
  for it instead of deploying again.
- `get_logs` with source `runtime` may return no lines while the app is running. Say so, use
  the deployment's stage messages, and ask the user to open the component's Runtime logs in
  the Skiff console if you need the app's output.
- Skiff builds every app from a Dockerfile in its source: `add_component` refuses a source
  without one, with a starter, and a deploy whose Dockerfile is gone fails at Fetch source.

## Build limits

- The build context is the component's `rootDir` only, and `.git` is removed.
- There are no build arguments. Anything the build needs comes from the source or the
  Dockerfile itself.
- A build stops after 15 to 20 minutes.
- The builder's network is locked down: it reaches public hosts over HTTPS, and nothing on
  a private network. A private npm registry, an internal host or a plain-HTTP download may
  fail; tell the user, and vendor the package or publish it where the build can reach it.
