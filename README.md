<img src="icons/hoard/linux/hicolor/256x256/apps/hoard.png" width="96" align="right" alt="Hoard icon">

# Hoard

A self-hosted tracker for the movies, shows and games you want to watch or play, with a phone-friendly web app, automatic details from OMDb, and a Jellyfin link that marks titles done when you've played them.

## What it does

- **Library with fast filters.** Switch between movies, shows and games; filter by status (want, doing, done, dropped), by tags grouped into your own groups, by "on the server" and "needs a look"; search; sort by Rotten Tomatoes score, year, rating, runtime or date added. Filters survive navigation and reloads.
- **Title pages.** Status, 1-to-5 stars, tags, who recommended it, progress (`S2E4`), finished date, and free-form notes. Every change saves at once with optimistic updates.
- **Automatic details.** A background enricher fills in IMDb ID, year, runtime, genre, Rotten Tomatoes score, summary, director, writer, cast and poster from OMDb, never overwriting what you typed. When it can't pick a match on its own, the title page offers the candidates.
- **Jellyfin integration.** Shows which titles are on your media server, fills missing IMDb IDs from Jellyfin when the match is unambiguous, and marks a title done when Jellyfin reports it played after your last edit.
- **"More like this" suggestions.** The server asks headless Claude Code for picks based on a tag, a recommender or a set of titles, checks each one against OMDb, drops what you already have or passed on, and keeps the rest in a suggestions inbox (API only; there's no web UI for it yet).
- **Safe storage.** One SQLite file with daily backups (30 kept), written atomically, plus a restore script.

## How it works

```
 browser (React SPA) ──/api──▶ Node server (Hono) ──▶ SQLite store (node:sqlite)
                                   │   │                 └─ daily backups
                     enricher loop ┘   └ watched loop
                          │                 │
                        OMDb             Jellyfin
```

- **Server** (`src/server/`): a Hono app on Node that serves the JSON API under `/api` and the built client, listening on `127.0.0.1` behind whatever proxy the host provides. Two loops run every five minutes: the enricher (OMDb lookups) and the watched loop (Jellyfin availability and play state). External services sit behind small interfaces (`ports.ts`) so tests swap in fakes.
- **Client** (`src/client/`): a React 19 single-page app using TanStack Query for caching and optimistic edits, with a tiny history-based router. On wide screens the library and the open title sit side by side. `pnpm dev:fake` runs it entirely in the browser against an in-memory fake API.
- **Shared** (`src/shared/`): the `Title` model and date rules used by both sides.
- **Assistant skill** (`skills/hoard/SKILL.md`): instructions for a Claude assistant that manages the library through `hoard_*` MCP tools. The MCP server that provides those tools lives outside this repo.
- **Grimoire import** (`scripts/onehome/`): earlier versions kept each title as a page in a Grimoire notes graph. A one-time, read-only import copies those pages into the store; [docs/title-page-format.md](docs/title-page-format.md) describes the old format. Hoard never writes to Grimoire, and a test enforces that.

## Tech stack

TypeScript (run directly by Node 26's type stripping, no build step for the server), Node `node:sqlite`, Hono, React 19, TanStack Query, Vite, Vitest with Testing Library and jsdom, Playwright. Deployment uses zsh scripts, launchd and Tailscale Serve on a macOS host.

## Getting started

Requirements: Node 26 or newer and pnpm. Optional: an [OMDb API key](https://www.omdbapi.com/apikey.aspx), a Jellyfin server, and the `claude` CLI for suggestions.

```sh
pnpm install
cp .env.example .env    # then fill in what you need; every value is optional
```

Configuration (see [.env.example](.env.example) for the full list):

| Variable | Used by | Meaning |
|---|---|---|
| `PORT` | server | Port on 127.0.0.1 (default 8781) |
| `HOARD_DATA` | server, scripts | Folder for the SQLite store and backups (default `~/Library/Application Support/Hoard`) |
| `OMDB_API_KEY` | server | Enables details and posters for movies and shows |
| `JELLYFIN_URL`, `JELLYFIN_API_KEY` | server | Enables "on the server" and auto-marking played titles |
| `HOARD_USER_NAME`, `HOARD_CLAUDE_MODEL`, `CLAUDE_BIN` | server | Suggestions: who they're for, which model, which `claude` binary |
| `VITE_SERVER_NAME` | client build | What the UI calls the server (default "the server") |
| `HOARD_DEPLOY_HOST` | `ops/deploy.sh` | ssh host to deploy to |
| `GRIMOIRE_GRAPH`, `GRIM_BIN` | import, tests | Grimoire graph folder and `grim` CLI path |

Run it locally:

```sh
pnpm dev:fake                          # client only, fake in-browser API: quickest way to look around
pnpm dev:server                        # API server on :8781, restarts on change
pnpm dev                               # Vite dev server; proxies /api to :8781
```

`pnpm start` and `pnpm dev:server` read settings from the environment, not from `.env`. To use the file, load it first, e.g. `node --env-file=.env src/server/main.ts`.

Production build and run:

```sh
pnpm build                             # client into dist/client, which the server serves
pnpm start                             # http://127.0.0.1:8781
```

### Deploying to a Mac server

`ops/deploy.sh`, run from your Mac, runs the tests and type check, builds the client, rsyncs the repo to `HOARD_DEPLOY_HOST`, installs production dependencies there, installs or restarts a launchd agent (`ops/com.nicholai.hoard.plist`, which runs `ops/run.sh`), and exposes the app on the tailnet with `tailscale serve` on port 8449. `ops/run.sh` loads the API keys from `~/.zshrc.local` on the server so secrets never sit in the repo or the plist.

### Maintenance scripts

```sh
node scripts/backup/restore.ts <backup-file>   # put a backup back (service stopped)
node scripts/onehome/import.ts                 # dry run of the Grimoire import
node scripts/onehome/import.ts --apply         # run it
```

Both refuse to touch the store while the server is running.

## Tests

```sh
pnpm test         # Vitest: 246 tests in 22 files
pnpm typecheck    # tsc --noEmit
pnpm build && pnpm e2e   # Playwright: 6 phone-width checks against a throwaway server
```

The unit and integration tests cover the API routes, the SQLite store and backups, the OMDb and Jellyfin clients (stubbed fetch, recorded Jellyfin responses), the enricher and watched loops, suggestion verification, the property-line parser, client filtering and optimistic patching, and the title page UI. Tests pin the time zone to `America/New_York`. The 10 Grimoire reader tests seed a throwaway graph through the `grim` CLI, so they need it installed (`GRIM_BIN`, default `~/.local/bin/grim`).

## Project layout

```
src/
  server/      API, store, enricher, Jellyfin and OMDb clients, suggestions, backups
  client/      React app: library, title page, add, tags, fake API for offline dev
  shared/      Title model and date rules used by server and client
scripts/       backup restore and the one-time Grimoire import
e2e/           Playwright phone checks and the throwaway server they run against
ops/           deploy script, launchd plist and service wrapper
skills/hoard/  assistant skill for the hoard_* MCP tools
docs/          title-page format of the old Grimoire pages
icons/hoard/   app icon for web, macOS, Windows, Linux and tvOS
public/        favicon, touch icon and web manifest served with the client
CLAUDE.md      working notes for AI-assisted development in this repo
```

## License

See [LICENSE](LICENSE).
