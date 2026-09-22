#!/usr/bin/env bash
set -euo pipefail
id=${1:?cutover ID required}
expected=${2:?SHA-256 required}
[[ "$id" =~ ^[0-9TZ-]+$ && "$expected" =~ ^[a-f0-9]{64}$ ]] || exit 1
archive="/var/tmp/cutover-${id}.tar.gz"
export_root="/var/tmp/mlgw-cutover-${id}"
test ! -e /var/lib/mlgw/collection-enabled
test ! -e /var/lib/mlgw/data/collector/production-state.json
printf '%s  %s\n' "$expected" "$archive" | sha256sum -c -
mkdir "$export_root"
tar -xzf "$archive" -C "$export_root"
/opt/node/bin/node /opt/mlgw/current/scripts/verify-deployment.mjs "$export_root"
cd /opt/mlgw/current
runuser -u mlgw -- /opt/node/bin/node /var/tmp/mlgw-import-cutover.mjs "$export_root"
runuser -u mlgw -- /opt/node/bin/node scripts/restore-production.mjs
install -m 0600 "$export_root/deployment-manifest.json" /etc/mlgw/cutover-manifest.json
chmod -R o-rwx "$export_root"
chmod 0600 "$archive"
touch /var/lib/mlgw/collection-enabled
systemctl start mlgw-collector mlgw-weather
systemctl start mlgw-health.timer
systemctl is-active mlgw-dashboard mlgw-collector mlgw-weather caddy
date --utc --iso-8601=seconds
