#!/usr/bin/env bash
# One-time setup for the Delta Earth API on a fresh Ubuntu 24.04 VM.
# Re-run it to update: it pulls the branch, reinstalls and restarts.
#   sudo REPO_BRANCH=main bash setup-vm.sh
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/U-m-4r/Delta-Earth-.git}"
REPO_BRANCH="${REPO_BRANCH:-main}"
API_DOMAIN="${API_DOMAIN:-api.deltaearth.earth}"
SITE_ORIGINS="${SITE_ORIGINS:-https://deltaearth.earth,https://www.deltaearth.earth}"
APP_DIR=/opt/delta-earth
DATA_DIR=/var/lib/delta-earth

# System packages; Caddy from its official apt repository (gives automatic HTTPS).
apt-get update
apt-get install -y git python3-venv debian-keyring debian-archive-keyring apt-transport-https curl gnupg
if ! command -v caddy >/dev/null; then
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update && apt-get install -y caddy
fi

# App user, code and persistent data directory.
id deltaearth >/dev/null 2>&1 || useradd --system --home "$APP_DIR" --shell /usr/sbin/nologin deltaearth
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" fetch origin "$REPO_BRANCH" && git -C "$APP_DIR" checkout -B "$REPO_BRANCH" "origin/$REPO_BRANCH"
else
  git clone --branch "$REPO_BRANCH" "$REPO_URL" "$APP_DIR"
fi
mkdir -p "$DATA_DIR"
python3 -m venv "$APP_DIR/Backend/.venv"
"$APP_DIR/Backend/.venv/bin/pip" install --upgrade pip
"$APP_DIR/Backend/.venv/bin/pip" install "$APP_DIR/Backend"

# Settings. The Earthdata token is added by hand afterwards and never committed.
ENV_FILE="$APP_DIR/Backend/.env"
if [ ! -f "$ENV_FILE" ]; then
  cat > "$ENV_FILE" <<EOF
EDL_TOKEN=
DATA_DIR=$DATA_DIR
FRONTEND_ORIGIN=$SITE_ORIGINS
EOF
fi
chmod 600 "$ENV_FILE"
chown -R deltaearth:deltaearth "$APP_DIR" "$DATA_DIR"

# API as a service, restarted on crash and on boot.
cat > /etc/systemd/system/delta-earth.service <<EOF
[Unit]
Description=Delta Earth API
After=network-online.target

[Service]
User=deltaearth
WorkingDirectory=$APP_DIR/Backend
ExecStart=$APP_DIR/Backend/.venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8787
Restart=always

[Install]
WantedBy=multi-user.target
EOF

# Caddy terminates HTTPS for the API domain and forwards to uvicorn.
cat > /etc/caddy/Caddyfile <<EOF
$API_DOMAIN {
  encode gzip
  reverse_proxy 127.0.0.1:8787
}
EOF

systemctl daemon-reload
systemctl enable --now delta-earth
systemctl restart delta-earth caddy

echo
grep -q '^EDL_TOKEN=$' "$ENV_FILE" && echo "Next: add your Earthdata token:  sudo nano $ENV_FILE  then  sudo systemctl restart delta-earth"
echo "Check: curl https://$API_DOMAIN/api/stories"
