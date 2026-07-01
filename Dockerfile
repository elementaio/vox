# syntax=docker/dockerfile:1
#
# One-command self-host: builds the web client and the Elixir relay into a
# single small image. `docker build` needs no Elixir/Node/pnpm on the host and
# no external paths — chat_engine is vendored under apps/server/vendor.
#
#   docker build -t pochta-relay .
#   docker run -p 4000:4000 -v chat-data:/data \
#     -e SECRET_KEY_BASE=$(openssl rand -base64 48) pochta-relay
#
# Then open http://localhost:4000 — the relay serves the client same-origin.

########## Stage 1 — build the web client (React/Vite → static bundle) ##########
FROM node:22-bookworm-slim AS web
WORKDIR /src
# Pin pnpm (matches package.json's packageManager) so builds don't drift to
# whatever "latest" corepack would fetch.
RUN corepack enable && corepack prepare pnpm@10.30.3 --activate
# pnpm 10 rejects lockfile entries published within the last day as a supply-chain
# guard; a committed, vetted lockfile shouldn't be blocked by "package too new" in
# a reproducible build. Set stage-wide so both `install` and `build`'s implicit
# dependency check honor it.
ENV npm_config_minimum_release_age=0
# Manifests first, so `pnpm install` is cached until deps actually change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
# The web app depends on the @pochta-chat/sdk workspace package; bring it in so
# the workspace install links it (and its deps) and the build can resolve it.
COPY packages packages
RUN pnpm install --frozen-lockfile --filter web...
COPY apps/web apps/web
RUN pnpm --filter web build          # → apps/web/dist

########## Stage 2 — build the Elixir release (bundles ERTS + SPA + SQLite) ####
FROM hexpm/elixir:1.18.4-erlang-27.3.4.13-debian-bookworm-20260623-slim AS build
# build-essential + git: exqlite (SQLite) compiles a C NIF at deps.compile.
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends build-essential git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
WORKDIR /app
ENV MIX_ENV=prod
RUN mix local.hex --force && mix local.rebar --force

# Deps first (cached until mix.exs/lock or the vendored engine change).
COPY apps/server/mix.exs apps/server/mix.lock ./
COPY apps/server/vendor vendor
RUN mix deps.get --only prod
# config before deps.compile: some deps read compile-time config (Mix convention).
COPY apps/server/config config
RUN mix deps.compile

# App source.
COPY apps/server/priv priv
COPY apps/server/lib lib
# Drop the compiled web bundle where the endpoint serves it (priv/static/app).
COPY --from=web /src/apps/web/dist priv/static/app

RUN mix compile
RUN mix release

########## Stage 3 — runtime (no build toolchain, just the release) ###########
FROM debian:bookworm-slim AS app
RUN apt-get update -y \
  && apt-get install -y --no-install-recommends libstdc++6 openssl libncurses6 ca-certificates \
  && rm -rf /var/lib/apt/lists/*
ENV LANG=C.UTF-8 MIX_ENV=prod
WORKDIR /app

# Persistent data: SQLite delivery buffer + the relay's Ed25519 identity key.
RUN mkdir -p /data && chown nobody:nogroup /data
COPY --from=build --chown=nobody:nogroup /app/_build/prod/rel/pochta ./

USER nobody
# Sensible self-host defaults; override any at `docker run -e ...`.
ENV PHX_SERVER=true \
    PORT=4000 \
    DATABASE_PATH=/data/chat.db \
    RELAY_KEY_PATH=/data/relay_identity.key
EXPOSE 4000
VOLUME /data
CMD ["/app/bin/pochta", "start"]
