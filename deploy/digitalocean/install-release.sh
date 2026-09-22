#!/usr/bin/env bash
set -euo pipefail
# Usage: install-release.sh /opt/mlgw/releases/RELEASE http://PUBLIC_IP
release=${1:?release directory required}
origin=${2:?public origin required}
[[ "$release" =~ ^/opt/mlgw/releases/[a-zA-Z0-9_-]+$ ]] || { echo 'Invalid release directory' >&2; exit 1; }
test -d "$release" && test -f /var/lib/mlgw/bootstrap-complete
test ! -L "$release"
/opt/node/bin/node -e 'const u=new URL(process.argv[1]);if(!["http:","https:"].includes(u.protocol)||u.username||u.password||u.pathname!=="/"||u.search||u.hash)process.exit(1)' "$origin"
# The initial migration is installed only on an empty application data directory.
if [[ -d "$release/migration/data" ]]; then
  test -z "$(find /var/lib/mlgw/data -mindepth 1 -maxdepth 1 -print -quit)" || { echo 'Data already exists; use an explicit archive import instead' >&2; exit 1; }
  cp -a "$release/migration/data/." /var/lib/mlgw/data/
fi
chown -R mlgw:mlgw /var/lib/mlgw/data /var/log/mlgw
ln -s /var/lib/mlgw/data "$release/data"
ln -s /var/log/mlgw "$release/reports"
install -d -m 0755 /etc/mlgw
printf 'PUBLIC_ORIGIN=%s\n' "$origin" > /etc/mlgw/dashboard.env
chmod 0644 /etc/mlgw/dashboard.env
for service in dashboard collector weather health; do
  install -m 0644 "$release/deploy/digitalocean/mlgw-${service}.service" /etc/systemd/system/
done
install -m 0644 "$release/deploy/digitalocean/mlgw-health.timer" /etc/systemd/system/
ln -sfn "$release" /opt/mlgw/current
cd /opt/mlgw/current
runuser -u mlgw -- env MLGW_COLLECTOR_CONFIG=config/collector.production.json /opt/node/bin/node scripts/restore-production.mjs
printf '%s {\n  encode gzip\n  reverse_proxy 127.0.0.1:4173\n}\n' "$origin" > /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now mlgw-dashboard
systemctl reload caddy
# Collection requires a distinct cutover step after local collection stops.
systemctl enable mlgw-collector mlgw-weather mlgw-health.timer
curl --fail --show-error --silent --retry 15 --retry-connrefused --retry-delay 1 http://127.0.0.1:4173/api/health
printf '\nDashboard installed; collection remains gated by /var/lib/mlgw/collection-enabled.\n'
