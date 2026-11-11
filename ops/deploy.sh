#!/bin/zsh
# Run on your Mac: test, build the client, copy the repo to the server, install runtime deps, (re)start the service.
# The server is the ssh host in HOARD_DEPLOY_HOST, set in the gitignored .env or the environment.
# First run also installs the launchd agent and the tailnet-only `tailscale serve` on :8449.
set -euo pipefail
cd "${0:A:h}/.."
if [[ -f .env ]]; then set -a; source ./.env; set +a; fi
host=${HOARD_DEPLOY_HOST:?set HOARD_DEPLOY_HOST to the server ssh host, e.g. in .env}
pnpm test
pnpm exec tsc --noEmit
pnpm build
rsync -az --delete --exclude node_modules --exclude .git --exclude .superpowers --exclude migration-report.md --exclude test-results ./ "${host}:Projects/hoard/"
ssh "$host" 'zsh -lc "
  set -e
  export PATH=/opt/homebrew/bin:\$PATH
  cd ~/Projects/hoard && pnpm install --prod --frozen-lockfile >/dev/null
  plist=~/Library/LaunchAgents/com.nicholai.hoard.plist
  rendered=\$(mktemp)
  sed \"s|__HOME__|\$HOME|g\" ops/com.nicholai.hoard.plist > \$rendered
  if ! cmp -s \$rendered \$plist; then
    launchctl bootout gui/\$(id -u)/com.nicholai.hoard 2>/dev/null || true
    cp \$rendered \$plist
    launchctl bootstrap gui/\$(id -u) \$plist
  else
    launchctl kickstart -k gui/\$(id -u)/com.nicholai.hoard
  fi
  rm -f \$rendered
  /Applications/Tailscale.app/Contents/MacOS/Tailscale serve status | grep -q \":8449\" ||
    /Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --https=8449 http://127.0.0.1:8781 >/dev/null
"'
sleep 3
ssh "$host" 'curl -sf http://127.0.0.1:8781/api/library >/dev/null && echo "hoard is up on the server" || (tail -20 ~/Library/Logs/hoard.log; exit 1)'
