#!/usr/bin/env bash
set -euo pipefail
id=${1:?release id required}
expected=${2:?archive SHA-256 required}
origin=${3:?public origin required}
[[ "$id" =~ ^[a-zA-Z0-9_-]+$ && "$expected" =~ ^[a-f0-9]{64}$ ]] || exit 1
archive="/var/tmp/mlgw-${id}.tar.gz"
actual=$(sha256sum "$archive")
test "${actual%% *}" = "$expected"
release="/opt/mlgw/releases/${id}"
mkdir -m 0755 "$release"
tar -xzf "$archive" --no-same-owner -C "$release"
/opt/node/bin/node "$release/scripts/verify-deployment.mjs" "$release"
chmod -R o-rwx "$release/migration"
chmod 0600 "$archive"
bash "$release/deploy/digitalocean/install-release.sh" "$release" "$origin"
