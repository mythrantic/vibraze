# AGENTS.md

## Project

Libre frontend for JioSaavn (Indian music streaming). SvelteKit 1.x + Svelte 4 + Tailwind 3 + Vite 4. Pure JavaScript (no TypeScript). PWA.

Internal name is "raga" but repo/remote is "vibraze"/"mythrantic/vibraze".

## Commands

```bash
yarn dev          # dev server at localhost:5173 (--host --open)
yarn build        # build for Vercel (adapter-auto)
yarn preview      # preview production build

DEPLOY_TARGET=node yarn build   # build for self-hosted Node.js (adapter-node)
node build                      # run the Node.js production build
```

Package manager: **yarn** (lock file is `yarn.lock`). Do not use npm/pnpm/bun.

## No Linting or Testing

There is no ESLint, Prettier, TypeScript checking, or test framework configured. The `test/` directory contains unrelated utility scripts -- not tests for this app.

## Build Adapter Switch

`svelte.config.js` selects adapter based on `DEPLOY_TARGET` env var:
- `auto` (default) -> `@sveltejs/adapter-auto` (Vercel)
- `node` -> `@sveltejs/adapter-node`

The `.env` file sets `PUBLIC_DEPLOY_TARGET=node`.

## Architecture

```
src/
  lib/
    info.js        -- API base URL, proxy config, endpoint definitions
    store.js       -- Svelte writable stores (player state, playlist, history)
    utils.js       -- Audio decryption (DES-ECB with key "38346591"), proxy URL rewriting
    components/    -- UI (Player, BiggerPlayer, Sidebar, Header, etc.)
    icons/         -- SVG icon components
    styles/        -- app.css, tailwind.css, range.css
  routes/
    api/           -- 13 server-side proxy endpoints to JioSaavn API
    album/[slug]/  -- Album page
    artist/[slug]/ -- Artist page
    song/[slug]/   -- Song page
    playlist/[slug]/ -- Playlist page
    search/        -- Search subpages (songs, albums, artists, playlists)
    settings/      -- Audio quality, history toggle
    history/       -- Listening history
```

Import alias: `$lib/` -> `src/lib/` (SvelteKit default).

## Key Quirks

- **Proxy system**: `src/lib/info.js` rewrites CDN URLs through `raga-backend.valiantlynx.com`. Toggle via `proxyEnabled` flag.
- **Audio decryption**: `src/lib/utils.js` decrypts JioSaavn audio URLs using DES-ECB (`node-forge`). Key is hardcoded.
- **Dark mode only**: Forced via CSS `color-scheme: dark` + Tailwind dark classes.
- **Font**: CircularStd via `@vetixy/circular-std` package.
- **No SSR data loading**: Pages use client-side fetch patterns in `+page.js` / `+layout.js`.

## Docker

```bash
# Dev (live reload, mounts source)
docker-compose --file docker-compose.dev.yml up -d

# Production (Dockerfile.solo, maps 3001:3000)
docker-compose up --build -d
```

Ignore `Dockerfile` (references old Turborepo monorepo layout). Use `Dockerfile.solo` for standalone builds.

## CI

`.github/workflows/valiantos.yaml`: builds Docker image on push/PR to `main`, pushes to Docker Hub + GHCR, dispatches downstream deployment.

## Branching

Development on `working` branch, production deploys from `main`.
