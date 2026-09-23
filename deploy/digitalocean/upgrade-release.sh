#!/usr/bin/env bash
set -euo pipefail
release=${1:?verified release directory required}
[[ "$release" =~ ^/opt/mlgw/releases/[a-zA-Z0-9_-]+$ ]] || exit 1
test -d "$release" && test ! -L "$release"
old=$(readlink -f /opt/mlgw/current)
[[ "$old" =~ ^/opt/mlgw/releases/[a-zA-Z0-9_-]+$ ]] && test "$old" != "$release"
id=${release##*/}
rebuild="/var/lib/mlgw/rebuild-${id}"
rollback="/opt/mlgw/rollbacks/${id}"
test ! -e "$rollback"
test -f /var/lib/mlgw/data/collector/last-backup.json
/opt/node/bin/node -e 'const fs=require("node:fs"),b=JSON.parse(fs.readFileSync(process.argv[1])),age=Date.now()-Date.parse(b.downloadedAt);if(b.verified!==true||!Number.isFinite(age)||age<0||age>86400000)throw Error("A verified PC backup less than 24 hours old is required")' /var/lib/mlgw/data/collector/last-backup.json
/opt/node/bin/node "$release/scripts/verify-deployment.mjs" "$release"
/opt/node/bin/node -e 'const fs=require("node:fs"),m=JSON.parse(fs.readFileSync(process.argv[1]));if(m.kind!=="code")throw Error("Code-only release required")' "$release/deployment-manifest.json"
test ! -e "$release/data" && test ! -e "$release/reports"
ln -s /var/lib/mlgw/data "$release/data"
ln -s /var/log/mlgw "$release/reports"
install -d -o mlgw -g mlgw -m 0750 "$rebuild"
cd "$release"
# Most work happens while the current collector continues. The final pass below
# incorporates any manifests published since this side-by-side rebuild.
runuser -u mlgw -- /opt/node/bin/node scripts/rebuild-index.mjs /var/lib/mlgw/data/collector "$rebuild"
install -d -m 0700 "$rollback"
cp -a /etc/systemd/system/mlgw-*.service "$rollback/"
printf '%s\n' "$old" > "$rollback/previous-release"
swapped=0
recover_previous() {
  status=$?
  trap - ERR
  systemctl stop mlgw-collector mlgw-dashboard mlgw-weather || true
  if [[ "$swapped" = 1 ]]; then
    # Keep the failed projection and all canonical observations for diagnosis.
    mv /var/lib/mlgw/data/collector/index.sqlite "$rollback/failed-index.sqlite"
    for suffix in -wal -shm; do
      if [[ -f /var/lib/mlgw/data/collector/index.sqlite${suffix} ]]; then mv "/var/lib/mlgw/data/collector/index.sqlite${suffix}" "$rollback/failed-index.sqlite${suffix}"; fi
    done
    cp -a "$rollback/index.sqlite" /var/lib/mlgw/data/collector/index.sqlite
  fi
  ln -sfn "$old" /opt/mlgw/current
  cp -a "$rollback/"mlgw-*.service /etc/systemd/system/
  systemctl daemon-reload
  systemctl start mlgw-dashboard mlgw-collector mlgw-weather mlgw-health.timer
  echo "Upgrade failed; restored $old; evidence retained in $rollback" >&2
  exit "$status"
}
trap recover_previous ERR
systemctl stop mlgw-weather
systemctl stop mlgw-health.timer mlgw-collector mlgw-dashboard
runuser -u mlgw -- /opt/node/bin/node scripts/rebuild-index.mjs /var/lib/mlgw/data/collector "$rebuild"
cp -a /var/lib/mlgw/data/collector/index.sqlite "$rollback/index.sqlite"
cp -a /var/lib/mlgw/data/collector/production-state.json "$rollback/production-state.json"
test ! -s /var/lib/mlgw/data/collector/index.sqlite-wal
cp -a "$rebuild/index.sqlite" /var/lib/mlgw/data/collector/index.next.sqlite
mv /var/lib/mlgw/data/collector/index.next.sqlite /var/lib/mlgw/data/collector/index.sqlite
swapped=1
for service in collector dashboard weather health; do install -m 0644 "deploy/digitalocean/mlgw-${service}.service" /etc/systemd/system/; done
ln -s "$release" /opt/mlgw/current.next
mv -Tf /opt/mlgw/current.next /opt/mlgw/current
systemctl daemon-reload
systemctl start mlgw-dashboard mlgw-collector mlgw-weather mlgw-health.timer
for attempt in {1..15}; do
  if curl -fsS http://127.0.0.1:4173/api/ready > "$rollback/post-deploy-health.json"; then break; fi
  sleep 1
done
curl -fsS http://127.0.0.1:4173/api/ready
systemctl is-active mlgw-dashboard mlgw-collector mlgw-weather
trap - ERR
printf '\nDeployed %s; rollback retained in %s\n' "$release" "$rollback"
