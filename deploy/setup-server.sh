#!/usr/bin/env bash
# One-time bootstrap for a fresh Lightsail instance to serve Wordsmith.
# Installs Caddy (automatic HTTPS), creates the web root, and wires in the
# Caddyfile for your domain. Works on Amazon Linux (dnf/yum) and
# Debian/Ubuntu (apt). Re-runnable.
#
# Usage (on the instance, with deploy/ copied over):
#   sudo DEPLOY_DOMAIN=wordsmith.example.com DEPLOY_USER=ec2-user bash setup-server.sh
#
# DEPLOY_DOMAIN  (required) the hostname you pointed at this instance
# DEPLOY_USER    (optional) the SSH user the Action rsyncs as
#                (default: ec2-user on Amazon Linux, else ubuntu)

set -euo pipefail

DEPLOY_DOMAIN="${DEPLOY_DOMAIN:-}"
WEBROOT="/var/www/wordsmith"

if [ -z "$DEPLOY_DOMAIN" ]; then
  echo "ERROR: set DEPLOY_DOMAIN=your.subdomain.example.com" >&2
  exit 1
fi
if [ "$(id -u)" != "0" ]; then
  echo "ERROR: run with sudo." >&2
  exit 1
fi

# Default the deploy user to whichever cloud-default account exists.
if [ -z "${DEPLOY_USER:-}" ]; then
  if id ec2-user >/dev/null 2>&1; then DEPLOY_USER=ec2-user; else DEPLOY_USER=ubuntu; fi
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

install_caddy_apt() {
  echo "==> Installing Caddy from the official apt repo"
  apt-get update -y
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' \
    | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' \
    > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y
  apt-get install -y caddy
}

# Universal path (Amazon Linux, RHEL, anything): official static binary +
# a caddy system user + a systemd unit. Avoids distro repo/COPR fragility.
install_caddy_binary() {
  echo "==> Installing Caddy from the official static binary"
  command -v curl >/dev/null 2>&1 || { (dnf install -y curl || yum install -y curl); }
  case "$(uname -m)" in
    x86_64|amd64) arch=amd64 ;;
    aarch64|arm64) arch=arm64 ;;
    armv7l) arch=armv7 ;;
    *) echo "ERROR: unsupported arch $(uname -m)" >&2; exit 1 ;;
  esac
  curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=${arch}" -o /usr/bin/caddy
  chmod +x /usr/bin/caddy

  echo "==> Creating caddy system user"
  getent group caddy >/dev/null || groupadd --system caddy
  id caddy >/dev/null 2>&1 || useradd --system --gid caddy \
    --create-home --home-dir /var/lib/caddy \
    --shell /usr/sbin/nologin caddy

  echo "==> Installing systemd unit"
  cat > /etc/systemd/system/caddy.service <<'UNIT'
[Unit]
Description=Caddy
Documentation=https://caddyserver.com/docs/
After=network.target network-online.target
Requires=network-online.target

[Service]
Type=notify
User=caddy
Group=caddy
ExecStart=/usr/bin/caddy run --environ --config /etc/caddy/Caddyfile
ExecReload=/usr/bin/caddy reload --config /etc/caddy/Caddyfile --force
TimeoutStopSec=5s
LimitNOFILE=1048576
PrivateTmp=true
ProtectSystem=full
AmbientCapabilities=CAP_NET_BIND_SERVICE
[Install]
WantedBy=multi-user.target
UNIT
}

echo "==> Installing Caddy"
if command -v apt-get >/dev/null 2>&1; then
  install_caddy_apt
else
  install_caddy_binary
fi
mkdir -p /etc/caddy

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
echo "Done. Caddy will serve https://$DEPLOY_DOMAIN once:"
echo "  1. DNS for $DEPLOY_DOMAIN points at this instance's public IP, and"
echo "  2. the Lightsail firewall allows TCP 80 and 443."
echo "Caddy fetches the TLS certificate automatically on first request."
echo "Deploy user (for the GitHub Action): $DEPLOY_USER"
