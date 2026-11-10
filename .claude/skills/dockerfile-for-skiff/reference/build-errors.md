# Build and start errors from a Dockerfile

Read the last lines of `get_logs` with source `build` and the failing `deploymentId`. If
lines were dropped and the cause is not in view, narrow with `since`.

## Build fails

| The build log says | Cause | Fix |
| --- | --- | --- |
| `failed to read dockerfile` or `Dockerfile: no such file` | The file is not named `Dockerfile`, or is not in `rootDir` | Rename it to `Dockerfile`, or set `dockerfilePath` relative to `rootDir` |
| `COPY failed` or `"/x": not found` | The path is outside `rootDir`, ignored by `.dockerignore`, or does not exist | Copy only paths inside `rootDir`; check `.dockerignore` |
| `npm ci` needs a lockfile, `Could not find a version`, `poetry.lock` missing | The lockfile is not committed | Generate it locally and commit it |
| `401`, `403`, `ETIMEDOUT`, `Could not resolve host` while installing packages | A private registry or internal host the builder cannot reach | Tell the user; if it only needs a token, `set_build_secrets` and `RUN --mount=type=secret,id=NAME`; else vendor the package or publish it where the build can reach it |
| A step needs a value that is empty | The Dockerfile relies on `--build-arg`; Skiff passes none | Give the `ARG` a default, or move the value into a committed non-secret file |
| `exec format error` during a `RUN` | A binary downloaded for another CPU | Download the build for the builder's architecture, or build from source |
| `The build did not finish within 20 minutes.` | Compiling too much, or a step that hangs | Use prebuilt wheels or binaries, cache dependency layers, remove interactive prompts |
| `The build pushed no image digest.` | The build finished without an image | Read the lines above it; deploy again once, then report it with `raise_support_request` if it repeats |
| `The build was cancelled.` | Someone or `cancel_deployment` stopped it | Deploy again when ready |

## Image built but will not start

| What you see | Cause | Fix |
| --- | --- | --- |
| `verify_deployment` says `unreachable`, the app logged that it started | It listens on `localhost`, or on a port other than `PORT` | Bind `0.0.0.0:$PORT` |
| `bind: permission denied` on port 80 or 443 | Ports below 1024 need root; Skiff runs as UID 1000 | Listen on `PORT` (8080) |
| `Read-only file system`, `EROFS`, `Permission denied` writing a file | The app writes outside `/tmp` | Write to `/tmp`; set `ENV HOME=/tmp`; symlink cache folders to `/tmp` |
| `Permission denied` reading an app file | The file is not readable by UID 1000 | Do not `chmod` files owner-only for another user |
| `exec format error` at start | The image is for another CPU | Let Skiff build it; do not use a prebuilt image for another platform |
| `No space left on device` writing to `/tmp` | `/tmp` holds at most 256Mi | Stream large files elsewhere, clean up temporary files |
| Killed after 30 seconds on every stop | The process ignores SIGTERM | Use exec-form `CMD`; `exec` the server in a shell wrapper; handle SIGTERM |
| `OOMKilled`, exit code 137 | Out of memory | Raise memory with `update_component` and `resources` |

## When the same error comes back

Run the image locally with Skiff's rules when Docker is installed:

```sh
docker build -t app .
docker run --rm --read-only --tmpfs /tmp -u 1000 -e PORT=8080 -p 8080:8080 app
```

After three different fixes for the same failure, stop and tell the user what you tried,
what each attempt showed, and what you think is left.
