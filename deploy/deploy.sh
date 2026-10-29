#!/usr/bin/env bash
# Deploy Wordsmith from this machine to a Caddy host over SSH (rsync).
#
#   deploy/deploy.sh           ship the static assets
#   deploy/deploy.sh --setup   one-time: web root + Caddy site block, then ship
#
# Target comes from the environment or a gitignored .deploy.env:
#   WS_HOST=3.11.222.182  WS_USER=ubuntu  WS_KEY=~/.ssh/key.pem
#   WS_DOMAIN=wordsmith.example.com
set -euo pipefail
cd "$(dirname "$0")/.."

[ -f .deploy.env ] && . ./.deploy.env
: "${WS_HOST:?set WS_HOST (or create .deploy.env)}"
: "${WS_DOMAIN:?set WS_DOMAIN}"
WS_USER="${WS_USER:-ubuntu}"
WS_ROOT=/var/www/wordsmith
SSH=(ssh -o IdentitiesOnly=yes ${WS_KEY:+-i "${WS_KEY/#\~/$HOME}"})
REMOTE="$WS_USER@$WS_HOST"

if [ "${1:-}" = "--setup" ]; then
  # Site block mirrors deploy/Caddyfile, with the domain filled in.
  block=$(sed -e '/^[[:space:]]*#/d' -e '/^$/d' -e "s|{\$DEPLOY_DOMAIN}|$WS_DOMAIN|" deploy/Caddyfile)
  "${SSH[@]}" "$REMOTE" "WS_ROOT=$WS_ROOT bash -s" <<EOF
set -euo pipefail
sudo mkdir -p "\$WS_ROOT" && sudo chown "\$(id -un)": "\$WS_ROOT" && sudo chmod 755 "\$WS_ROOT"
cf=/etc/caddy/Caddyfile
sudo cp "\$cf" "\$cf.bak.\$(date +%Y%m%d%H%M%S)"
tmp=\$(mktemp)
sudo sed '/^# BEGIN wordsmith/,/^# END wordsmith/d' "\$cf" > "\$tmp"
printf '\n# BEGIN wordsmith (managed by Wordsmith deploy/deploy.sh)\n%s\n# END wordsmith\n' '$block' >> "\$tmp"
sudo caddy validate --adapter caddyfile --config "\$tmp"
sudo install -m 644 "\$tmp" "\$cf" && rm -f "\$tmp"
sudo systemctl reload caddy
EOF
fi

rm -rf .staging && mkdir .staging
cp -r index.html sw.js manifest*.webmanifest css js icons vendor .staging/
rsync -az --delete -e "${SSH[*]}" .staging/ "$REMOTE:$WS_ROOT/"
rm -rf .staging

# Health check: the shell and the service worker must both be served.
for p in / /sw.js /manifest-glass.webmanifest; do
  code=$(curl -s -o /dev/null -w '%{http_code}' "https://$WS_DOMAIN$p")
  echo "$code  https://$WS_DOMAIN$p"
  [ "$code" = 200 ] || { echo "health check failed" >&2; exit 1; }
done
