# Hoard

A movies, TV and games app. Everything it knows lives in its own SQLite store on the server; Grimoire (a notes app) is the user's notebook, and Hoard only reads it, once, to import old title pages. The web app is served by the server; companion Apple apps (a separate repo) list and play titles through Jellyfin.

This repo is public: tests, fixtures, sample data, docs and comments must be generic, with no personal data (real names, personal media or reading lists, calendars, health, money, machine names). Machine-specific and personal notes live in the gitignored `CLAUDE.local.md`; read it too.

Books belong to Stacks, a separate app that still keeps books on Grimoire pages. Hoard's copy of the Grimoire adapter (`src/server/grim.ts`, `grimoire.ts`) is read-only and used only by the one-time import (`scripts/onehome/`); a fix to shared reading behavior (page format, the other-type guard) is worth mirroring in Stacks' copy.

## Dependency rule
Hoard keeps its data in its own store and writes nothing to Grimoire; after the one-time import it only ever reads it, if at all. Grimoire never depends on Hoard and has no knowledge of it.
- Keep everything about the app in this repo: schema, conventions, docs, code. Never put Hoard docs, config or notes in Grimoire.
- Never create or edit a title page in Grimoire; what the user writes there is theirs.
- A Grimoire change made to help Hoard must be a generic feature that makes sense without Hoard and never names it.

## Local settings
The gitignored `.env` holds per-install settings. `ops/deploy.sh` and `ops/run.sh` source it, and Vite reads its `VITE_*` values at build time:
- `HOARD_DEPLOY_HOST`: the ssh host `ops/deploy.sh` deploys to.
- `VITE_SERVER_NAME`: what the UI calls the server ("On <name>"); default "the server".
- `HOARD_USER_NAME`: who suggestions are for, by name in Claude's prompt; default "someone".

Dates such as `finished` use the server's local time zone (the browser's for optimistic updates); tests pin `America/New_York` in `vitest.config.ts`.
