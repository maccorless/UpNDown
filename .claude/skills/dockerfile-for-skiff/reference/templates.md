# Dockerfile templates for Skiff

Each one builds in one stage, runs from a slim one as UID 1000 with `HOME=/tmp`, and
listens on `PORT` (8080 by default). Adapt paths, versions and commands to the app.

## Go

```dockerfile
FROM golang:1.23 AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -o /out/app ./cmd/server

FROM gcr.io/distroless/static-debian12
COPY --from=build /out/app /app
USER 1000
ENTRYPOINT ["/app"]
```

The code reads `os.Getenv("PORT")` and listens on `":" + port` (all interfaces). Handle
SIGTERM with `signal.NotifyContext` and `server.Shutdown`.

## Java (Maven, Spring Boot)

```dockerfile
FROM maven:3.9-eclipse-temurin-21 AS build
WORKDIR /src
COPY pom.xml .
RUN mvn -q dependency:go-offline
COPY src ./src
RUN mvn -q package -DskipTests

FROM eclipse-temurin:21-jre
WORKDIR /app
ENV HOME=/tmp JAVA_TOOL_OPTIONS="-XX:MaxRAMPercentage=75 -Djava.io.tmpdir=/tmp"
COPY --from=build /src/target/*.jar app.jar
USER 1000
CMD ["java", "-jar", "app.jar"]
```

Set `server.port=${PORT:8080}` in `application.properties` so Spring Boot reads `PORT`. Without a memory
limit on the component, set `-Xmx` instead of `MaxRAMPercentage`.

## Ruby (Rails or Rack)

```dockerfile
FROM ruby:3.3-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libpq-dev
COPY Gemfile Gemfile.lock ./
RUN bundle config set without 'development test' && bundle install
COPY . .

FROM ruby:3.3-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends libpq5 && rm -rf /var/lib/apt/lists/*
ENV HOME=/tmp RAILS_ENV=production RAILS_LOG_TO_STDOUT=1
COPY --from=build /usr/local/bundle /usr/local/bundle
COPY --from=build /app /app
USER 1000
CMD ["sh", "-c", "bin/rails db:migrate && exec bundle exec puma -b tcp://0.0.0.0:$PORT"]
```

Rails writes `tmp/` and `log/` in the app folder; point them at `/tmp`
(`RUN rm -rf tmp log && ln -s /tmp tmp && ln -s /tmp log`).

## Static site (Vite, React, Vue, Angular build output)

```dockerfile
FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html
USER 1000
CMD ["nginx", "-g", "daemon off;"]
```

With this `nginx.conf` beside it, so nginx runs unprivileged on 8080 with every write in
`/tmp`:

```nginx
worker_processes 1;
pid /tmp/nginx.pid;
error_log /dev/stderr;
events {}
http {
  include /etc/nginx/mime.types;
  access_log /dev/stdout;
  client_body_temp_path /tmp/client_body;
  proxy_temp_path /tmp/proxy;
  fastcgi_temp_path /tmp/fastcgi;
  uwsgi_temp_path /tmp/uwsgi;
  scgi_temp_path /tmp/scgi;
  server {
    listen 8080;
    root /usr/share/nginx/html;
    location / { try_files $uri $uri/ /index.html; }
  }
}
```

nginx does not read `PORT`, so the component keeps `targetPort` 8080. Values the browser
needs are baked in at build time; commit non-secret ones in `.env.production`.

## Node.js and Python

See the `node-on-skiff` and `python-on-skiff` skills. The Skiff guide's `deploying` topic
also has short starting points for Node, Python and Go.

## .dockerignore, any language

List `.git`, `.env` and `.env.*`, dependency folders (`node_modules`, `.venv`,
`__pycache__`) and build output (`target`, `dist`, `build`, `coverage`). Remove any entry
the build needs, such as `.env.production` when it holds non-secret build values.
