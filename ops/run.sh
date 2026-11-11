#!/bin/zsh
# Launched by launchd on the server (com.nicholai.hoard). Loads secrets (JELLYFIN_URL, JELLYFIN_API_KEY,
# OMDB_API_KEY) from ~/.zshrc.local at runtime so they never live in the plist or this repo, then the
# repo's gitignored .env (local settings such as HOARD_USER_NAME), if there is one.
source ~/.zshrc.local
cd "${0:A:h}/.."
if [[ -f .env ]]; then set -a; source ./.env; set +a; fi
export PORT=8781
exec /opt/homebrew/bin/node src/server/main.ts
