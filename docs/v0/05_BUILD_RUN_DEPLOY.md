# 05 — Build, Run & Deploy

## 1. Prerequisites

- **Node.js** with `node:sqlite` support (a recent LTS). No native build tools
  are required — SQLite is built in, which is deliberate for Windows friendliness.
- **npm** (workspaces).

## 2. Install

From the repo root:

```
npm install
```

This installs all workspaces (`packages/core`, `packages/server`, `apps/web`).

## 3. Run (two terminals)

The server (port 4000) and the web app (port 3000) run separately.

```
# Terminal 1 — API server
npm run dev

# Terminal 2 — web app
npm run dev:web
```

Then open `http://localhost:3000`. Hard-refresh (Ctrl+Shift+R) after a deploy to
beat stale build caches.

## 4. Verify (the checks used during development)

```
npm run typecheck                              # core + server types
npm test                                       # vitest in packages/core (invariants + w-engine)
npx tsc -p apps/web/tsconfig.json --noEmit     # web types
npm run build:web                              # production web build
```

Note: a Google-Fonts "Failed to minify" warning during `build:web` is **benign**.
Success is confirmed by the "✓ Compiled successfully" line, not the absence of
that warning.

## 5. Database re-seed (important gotcha)

The SQLite DB **persists** between runs, and `seed.ts` only runs on a **fresh**
DB. So whenever you change `seed.ts` (new demo markets, new taxonomy tags, etc.),
you must delete the `.db` files or the new seed data will not appear:

```
# Windows / PowerShell
Get-ChildItem -Recurse -Filter *.db | Remove-Item -Force
```

Forgetting this produces "I don't see the new feature" confusion. It is the single
most common operational mistake in this project.

## 6. The build-version badge

`apps/web/app/layout.tsx` renders a small **build number badge** next to the
Augora logo. It exists so you can confirm at a glance *which build is actually
live* in the browser (stale-build debugging). Bump it on every release (the
project bumped it via a `sed` one-liner). Build history is in
06_STATUS_GAPS_ROADMAP.md.

> Documentation-only changes (like this `docs/` set) do **not** bump the badge.

## 7. Deploy flow (the established Windows workflow)

The working copy lives on Windows; releases were delivered as a zip that lands on
the Desktop and is expanded over the working tree, then committed and pushed. The
exact per-release sequence:

```
cd C:\Users\SARFACE\Desktop\augora7\augora

# 1. stop running node processes
Get-Process node -ErrorAction SilentlyContinue | Stop-Process -Force

# 2. expand the delivered zip over the working tree
Expand-Archive -Path "C:\Users\SARFACE\Desktop\augora.zip" `
  -DestinationPath C:\Users\SARFACE\Desktop\augora7 -Force

# 3. commit & push
git add .; git commit -m "build N"; git push

# 4. run (two terminals, as in §3)
npm run dev
npm run dev:web
```

If `seed.ts` changed in this release, run the re-seed delete (§5) before step 4.
Repo: `https://github.com/gkazemikhanghah-maker/augora.git` (public).

## 8. Producing a release zip (how builds were packaged)

From the build environment, the project excludes `node_modules`, `.next`, `.git`,
logs, build info and local `.db` files:

```
zip -rq augora.zip augora \
  -x 'augora/node_modules/*' -x '*/node_modules/*' \
  -x 'augora/apps/web/.next/*' -x '*/.git/*' \
  -x '*.log' -x '*.tsbuildinfo' -x '*.db'
```
