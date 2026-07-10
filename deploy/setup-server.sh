#!/usr/bin/env bash
# One-time bootstrap for a fresh Lightsail instance to serve Wordsmith.
# Installs Caddy (automatic HTTPS), creates the web root, and wires in the
# Caddyfile for your domain. Re-runnable (idempotent-ish).
#
# Usage (on the instance, from the repo's deploy/ dir or with the file copied over):
#   sudo DEPLOY_DOMAIN=wordsmith.example.com DEPLOY_USER=ubuntu bash setup-server.sh
#
# DEPLOY_DOMAIN  (required) the hostname you pointed at this instance
# DEPLOY_USER    (optional) the SSH user the GitHub Action rsyncs as (default: ubuntu)

set -euo pipefail

DEPLOY_DOMAIN="${DEPLOY_DOMAIN:-}"
DEPLOY_USER="${DEPLOY_USER:-ubuntu}"
WEBROOT="/var/www/wordsmith"

if [ -z "$DEPLOY_DOMAIN" ]; then
  echo "ERROR: set DEPLOY_DOMAIN=your.subdomain.example.com" >&2
  exit 1
fi
if [ "$(id -u)" != "0" ]; then
  echo "ERROR: run with sudo." >&2
  exit 1
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "==> Installing Caddy"
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
elif command -v dnf >/dev/null 2>&1; then
  dnf install -y 'dnf-command(copr)'
  dnf copr enable -y @caddy/caddy
  dnf install -y caddy
elif command -v yum >/dev/null 2>&1; then
  yum install -y yum-plugin-copr
  yum copr enable -y @caddy/caddy
  yum install -y caddy
else
  echo "ERROR: no supported package manager (apt/dnf/yum) found." >&2
  exit 1
fi

echo "==> Creating web root $WEBROOT (owned by $DEPLOY_USER, world-readable)"
mkdir -p "$WEBROOT"
chown -R "$DEPLOY_USER":"$DEPLOY_USER" "$WEBROOT"
chmod -R 755 "$WEBROOT"
if [ ! -f "$WEBROOT/index.html" ]; then
  cat > "$WEBROOT/index.html" <<'HTML'
<!doctype html><meta charset="utf-8"><title>Wordsmith</title>
<p>Deploy pending — push to the branch or run the GitHub Action.</p>
HTML
  chown "$DEPLOY_USER":"$DEPLOY_USER" "$WEBROOT/index.html"
fi

echo "==> Installing Caddyfile"
install -m 644 "$SCRIPT_DIR/Caddyfile" /etc/caddy/Caddyfile

echo "==> Passing DEPLOY_DOMAIN to Caddy via a systemd drop-in"
mkdir -p /etc/systemd/system/caddy.service.d
cat > /etc/systemd/system/caddy.service.d/override.conf <<EOF
[Service]
Environment=DEPLOY_DOMAIN=$DEPLOY_DOMAIN
EOF

echo "==> Starting Caddy"
systemctl daemon-reload
systemctl enable caddy
systemctl restart caddy

echo
echo "Done. Caddy is serving https://$DEPLOY_DOMAIN once:"
echo "  1. DNS for $DEPLOY_DOMAIN points at this instance's public IP, and"
echo "  2. the Lightsail firewall allows TCP 80 and 443."
echo "Caddy fetches the TLS certificate automatically on first request."
