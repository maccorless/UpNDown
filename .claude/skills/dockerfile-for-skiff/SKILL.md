---
name: A Dockerfile that builds
description: Use when the user's app needs a Dockerfile to build and run on Skiff, or its existing Dockerfile fails to build on Skiff or produces an image that will not start there.
summary: Writes a small, safe Dockerfile for the app in any language, with a multi-stage build, user 1000, a read-only filesystem and the port Skiff sends traffic to.
version: 1.1.1
tags:
  - docker
  - dockerfile
  - build
  - containers
  - deploy
targets: [claude, codex, cursor, generic]
author: Platform team
category: get-running
why: >
  Skiff builds the app from its Dockerfile when it has one, and a Dockerfile is the most
  reliable way to deploy. A hand-written one often runs as root, writes to its own folder,
  listens on port 80, ships build tools to production, or depends on build arguments Skiff
  does not pass. Each of those builds fine on a laptop and then fails on Skiff. This skill
  writes one that avoids all of them.
outcomes:
  - Write a multi-stage Dockerfile for the app's language
  - Run the app as user 1000 with only /tmp writable
  - Make the app listen on the PORT Skiff gives it
  - Add a .dockerignore so secrets and build output stay out
  - Build it on Skiff and fix any build error
asks:
  - Write a Dockerfile for this repo so it runs on Skiff
  - Our Dockerfile builds locally but fails on Skiff
  - Make our image smaller
prerequisites:
  - The app's source, in a Git repository or a local folder
  - The command that starts the app
---

# A Dockerfile that builds

Use this skill when the user's app needs a Dockerfile for Skiff, or its Dockerfile builds
locally but fails to build or start on Skiff. It is for the user's app, in any language; it
is not for operating Skiff itself. For a Node.js or Python web app, the `node-on-skiff` or
`python-on-skiff` skill has framework-specific templates; use this one for other languages,
static sites, or a Dockerfile that already exists.

## What Skiff does with a Dockerfile

- Every deploy builds from a Dockerfile in the source: the `Dockerfile` (or `Containerfile`)
  in the component's `rootDir`, or the file `dockerfilePath` names. A source without one is
  refused with a starter, and a deploy whose Dockerfile is gone fails at Fetch source.
- The build context is `rootDir` only, with `.git` removed. `COPY ../shared` and any path
  outside `rootDir` fail.
- There are no build arguments and no platform option. An `ARG` with no default is empty.
  The image is built for the cluster's own CPU.
- A secret the build needs, such as a private registry token, is a build secret: ask the
  user for it, store it with `set_build_secrets`, and read it in one step with
  `RUN --mount=type=secret,id=NAME ...` (a file at `/run/secrets/NAME`). Never `COPY` or
  `ARG` it into a layer. It reaches builds only, never the running app.
- The build stops after 15 to 20 minutes.
- The builder's network is locked down: it reaches public hosts over HTTPS, and nothing on
  a private network. A private registry, an internal mirror or a plain-HTTP download may
  fail.

## What the image must do at runtime

- Listen on `$PORT` on `0.0.0.0`. Skiff sets `PORT` to the component's `targetPort`, 8080
  by default; ports below 1024 are refused. `EXPOSE` is not read by Skiff.
- Start listening within 10 minutes. Health checks are TCP connects on the port, not an
  HTTP path, and the `HEALTHCHECK` instruction is ignored.
- Run as UID 1000. Skiff forces it whatever `USER` says, so every file the app reads must
  be readable by UID 1000.
- Write only to `/tmp` (256Mi, emptied on restart). The rest of the filesystem is
  read-only. Set `ENV HOME=/tmp` for tools that write to `$HOME`.
- Handle SIGTERM: Skiff kills the process 30 seconds later. Use the exec form of `CMD`, and
  `exec` the server when a shell wrapper runs migrations first.
- Log to stdout and stderr.

## Work in this order

1. **Read the app.** Find the language and version, how dependencies install, the build
   step, the start command, the port it listens on, whether it reads `PORT`, any files it
   writes, and its migrations. If a Dockerfile exists, read it against the two lists above.
2. **Start from a template.** Copy the matching one from `reference/templates.md` and fit
   it to the app. Never paste one without checking the real start command, migration
   command and port.
3. **Keep stages apart.** Install and build in the first stage; copy only the runtime
   artefacts into a slim second stage.
4. **Set the runtime rules.** `ENV HOME=/tmp`, `USER 1000`, exec-form `CMD`, the app bound
   to `0.0.0.0:$PORT`.
5. **Write a `.dockerignore`.** Drop `.git`, `.env` files, dependency folders and build
   output, so secrets and stale artefacts stay out of the image.
6. **Build locally if Docker is installed.** `docker build -t app .` then
   `docker run --rm --read-only --tmpfs /tmp -u 1000 -e PORT=8080 -p 8080:8080 app`
   reproduces Skiff's runtime rules in seconds.
7. **Get it into the source.** Follow the Skiff guide's `deploying` topic: for a GitHub
   repository, commit on a new branch, open a pull request, and merge only on the user's
   yes; for an upload, put it in the folder before `upload_source`. If you cannot push,
   give the user the file and wait until they say it is in the repository.
8. **Deploy.** For a new component, `add_component` with kind `repo` (or `upload` with its
   `uploadId`), `generateDomain: true` and `deploy: true`; leave
   `targetPort` at 8080 unless the app cannot read `PORT`, since it cannot be changed through
   MCP later. For an existing component, `deploy` with mode `deploy`. Then poll
   `get_project` until it settles; never deploy again while it builds.
9. **Fix build errors.** Read `get_logs` with source `build` and the deployment's
   `deploymentId`. Match the last lines against `reference/build-errors.md`, fix, deploy
   again.

## Done when

- The deployment reaches `active` and `verify_deployment` says `reachable`.
- The URL `get_project` reports for the component answers. Use it as given; do not assume
  `https`.

## Known issues

- Right after `add_component` with `deploy: true`, `verify_deployment` may say the component
  was never deployed. Check `list_deployments` first; if one is `building`, wait.
- `get_logs` with source `runtime` may return no lines while the app runs. Say so, use the
  deployment's stage messages, and ask the user to check the component's Runtime logs in
  the Skiff console.
