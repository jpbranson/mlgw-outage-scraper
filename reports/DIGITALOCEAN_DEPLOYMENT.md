# DigitalOcean deployment

The dashboard is live at **https://64.225.60.118**. Outage and weather collection run on the VM independently of this PC. Public pages include the current feed, legacy archive and all four weather comparisons. This is a public, read-only dashboard without viewer login, as specified in the design.

## Deployment facts

| Item | Value |
| --- | --- |
| Deployment date | September 22, 2026 |
| Droplet | `mlgw-outage-prod`, ID `602733496`, region `nyc3` |
| Selected plan | `s-1vcpu-2gb`: 1 CPU, 2 GB RAM, 50 GB disk; $12/month base VM price |
| OS / runtime | Ubuntu 24.04, Node 24.19.0 |
| Public origin | `https://64.225.60.118` |
| Application | `/opt/mlgw/current` → `/opt/mlgw/releases/2026-09-23T03-49-04-921Z` |
| Persistent data | `/var/lib/mlgw/data`; release `data` is a symlink here |
| Dashboard | `127.0.0.1:4173`, served publicly through Caddy |
| Outage schedule | Five minutes; continuous production state, no trial deadline |
| Weather schedule | Thirty minutes; continuous production state, no trial deadline |
| HTTPS | Let's Encrypt IP certificate, automatic renewal checked twice daily |
| Health checks | Every two minutes, recorded in the system journal |

Paid DigitalOcean backups and extra storage products are not enabled. The account token remains in ignored local `data/deployment/digitalocean-token.txt`; it was not included in any upload. Runtime collection and SSH do not depend on that token. The SSH private key is `data/deployment/mlgw_ed25519`, with a restricted Windows ACL. Keep the key and token out of Git and chat.

## Verified handoff and operation

**Audit release, September 22 at 10:53 PM CDT / September 23 at 03:53 UTC:** deployed the [technical audit changes](TECHNICAL_AUDIT_IMPLEMENTATION.md) as a verified, code-only release. Bundle SHA-256: `0b02453da397cf8e669269e6887de514ffd9e7929417b5b8d2c43980029f8ed6`. The production rebuild preserved **1,818 attempts and 1,731 snapshots**, with zero added, removed or changed snapshot selections/totals and SQLite integrity `ok`. Linux and Windows each passed all **203 Node tests**; TypeScript/build, **four desktop/phone browser cases**, **26 Python tests** and **30 public HTTPS checks** passed. Private health was `ok`, all application services were active with zero restarts, and the running dashboard's archive mount was confirmed `ro`. The previous release/index/units are retained in `/opt/mlgw/rollbacks/2026-09-23T03-49-04-921Z/`.

The pre-upgrade PC backup `mlgw-2026-09-23T03-50-04-001Z.tar.gz` verified **6,595 files**, then restored **1,817 attempts and 1,730 snapshots** offline with integrity `ok`; its SHA-256 is `555d21398d24663fbb5353dc91e8431fbb7a9d13649389ed93ab26e1160dc3a8`. The cloud collector captured one additional observation during the backup/rebuild window, and final cutover included it. Scheduled PC backups are now installed; optional external monitoring remains unconfigured by the user's choice. The earlier deployment and repair records below are dated history.

The installed Windows task was executed at **10:54 PM CDT** and completed with `LastTaskResult=0`. It downloaded and verified the new release with all **1,818 attempts** in `mlgw-2026-09-23T03-54-02-690Z.tar.gz` (SHA-256 `caa7b0378bfc206eee25055fb1cd6d367044de6d37d5461468c65ea933b38d32`). Its next scheduled execution is September 23 at 10 AM Central.

The next scheduled cloud observation published at **03:55:07 UTC**, after the upgrade, with **79 customers / 8 reported outages**, `valid` quality and public readiness `ok`.

The local weather runner stopped cleanly. The local outage collector stopped between polls at **13:56:33 UTC / 8:56:33 AM CDT**, after its 13:55 capture. Its state records `stopReason=cloud_cutover`; original history, inbox and weather evidence remain on this PC. The pre-cutover states are saved in ignored `data/deployment/local-cutover-before.json`.

Final migration verified **1,722 archived attempts**, all referenced compressed originals and pinned parsers, and restored **1,635 indexed snapshots**. It also preserved the published legacy SQLite index, four comparison cases, saved weather evidence and the rolling weather cache. SQLite was rebuilt from the canonical archive rather than copied while open. No local PID, lease or trial state was migrated.

Cloud services started at **13:59:20 UTC / 8:59:20 AM CDT**. Valid source observations arrived at **14:00:21** and **14:05:23 UTC**, continuing the five-minute cadence across the handoff without losing an expected slot. Weather refresh completed successfully at 13:59:45 UTC. A controlled service restart preserved schedules and history. The former trial's end date does not stop the production runners; this migration is not a claim that the original local seven-day trial passed.

Validation completed:

- All **187 Node tests passed** offline in Linux with a 1 CPU / 2 GB limit; TypeScript and frontend build passed.
- Initial and final migration files were checked against individual SHA-256 hashes, with successful SQLite integrity checks after restore.
- **30 public HTTPS checks passed** with fresh cloud observations, including pages/assets, current data, spatial/Census routes, exports, legacy catalog, four comparison cases and weather routes. Raw database paths, admin routes, write methods and foreign origins were rejected.
- HTTPS certificate renewal succeeded against the certificate authority's staging service, including the deployment hook. Renewal timer is enabled.
- Dashboard, collector and weather services are enabled at boot. They run as `mlgw`, with filesystem and memory restrictions and restart on failure. Intentional source/storage stops are preserved rather than restarted in a loop.
- Firewall exposes SSH, HTTP and HTTPS only. Dashboard and Caddy administration listeners remain on loopback. SSH password authentication is disabled.
- A downloaded cloud backup was fully verified and restored offline in Linux: **6,315 files**, **1,723 attempts**, **1,636 snapshots**, SQLite integrity `ok`.

At the initial operating check, the VM had about **44 GiB free disk space** and **1.2 GiB available RAM**. Measured service memory peaks were approximately 97 MiB for the dashboard, 48 MiB for the collector and 277 MiB for weather. These are observed light-load measurements, not a stress or uptime guarantee. Browser automation was unavailable at the initial handoff; the later audit release passed the four desktop/phone Playwright cases recorded above.

**Documentation audit, September 22 at 16:26 UTC:** read-only checks confirmed that the dashboard, both collectors, Caddy, health timer and certificate timer were active; application services and timers were enabled at boot. Public health was `ok` with the 16:25:22 UTC capture, and the private health check reported no issues. About 44 GiB remained free. This audit did not restart services or rerun the deployment tests.

**Documentation recheck, September 22 at 11:11 PM CDT / September 23 at 04:11 UTC:** the active release resolved to `/opt/mlgw/releases/2026-09-23T03-49-04-921Z`; the dashboard, outage collector, weather service and health timer were active. Private health at 04:11:24 UTC was `ok`, with no issues, 46,582,018,048 free disk bytes and the 03:54:45 UTC verified backup receipt. External monitoring reported `configured=false`. Task Scheduler confirmed the installed daily/login backup task, last result `0` and next run September 23 at 10 AM Central. These were read-only checks; no services, schedules or backups were changed.

## September 22 archive compatibility repair

At 4:10 PM CDT (21:10 UTC), the outage collector encountered an empty feed identical to one migrated from Windows. Its gzip header differed from Linux's encoding by one OS metadata byte. The archive writer compared compressed bytes even though the object key identifies the uncompressed original, raised `Immutable object conflict`, and repeatedly failed during startup recovery. The dashboard continued serving the 4:05 PM capture; weather collection remained active.

The repair preserves an existing gzip file when bounded decompression matches the original exactly, reports its actual stored size, and retains strict byte comparisons for manifests/parsers. Corrupt or mismatched originals still fail. All **192 Node tests passed locally**, including five added regression tests; **30 archive, durable collector and production tests passed on the Linux VM** before deployment.

The active release's `src/durable/archive.mjs` was patched at **10:14 PM CDT on September 22 (03:14 UTC September 23)** and only the outage collector was restarted. The pending 4:10 PM capture was recovered with verified detail. Fresh captures published at **10:14:30 PM** and the next scheduled **10:15:01 PM CDT**. All **30 public HTTPS checks passed**, and the private health check returned `ok` with no issues. The conflicting archived gzip retained its exact checksum. The approximately six-hour interval without observations remains a collection gap; recovery does not invent missing captures.

The deployment record, Linux test log, prior module and prior collector state are retained in `/opt/mlgw/hotfixes/2026-09-23-archive-gzip/`. The module installed by that repair had SHA-256 `8900a042322f99bf4052d8de1af70a4cbee3ec836bac3789d5f1c55b2eaa9398`. The prior module is `archive.mjs.before`; no canonical archive objects were replaced or removed. The subsequent audit release is the current deployment.

## Operating commands

Run from `C:\Developer\mlgw-outage-scraper` in PowerShell:

```powershell
# Public endpoint verification; writes reports/cloud-verification.json.
npm.cmd run deploy:verify

# Download and checksum a complete archive/application/study backup to this PC.
npm.cmd run deploy:backup

# Connect using the pinned server host key.
ssh -o StrictHostKeyChecking=yes -o UserKnownHostsFile=data/deployment/known_hosts -i data/deployment/mlgw_ed25519 root@64.225.60.118
```

Inside the SSH session:

```bash
systemctl status mlgw-dashboard mlgw-collector mlgw-weather --no-pager
journalctl -u mlgw-collector -u mlgw-weather -n 30 --no-pager
journalctl -u mlgw-health -n 12 --no-pager
systemctl list-timers mlgw-health.timer mlgw-certbot.timer --no-pager
cat /var/lib/mlgw/data/collector/production-state.json
cat /var/lib/mlgw/data/weather/production/state.json
df -h /
```

To deliberately pause both collectors, including after reboot:

```bash
systemctl disable --now mlgw-collector mlgw-weather
```

To resume an ordinary service pause after reviewing source access and storage:

```bash
systemctl enable --now mlgw-collector mlgw-weather
```

A saved `stopReason` or operator stop file requires separate review; enabling/restarting a service does not clear it. Collector stop file: `/var/lib/mlgw/data/collector/production.stop`. Weather stop file: `/var/lib/mlgw/data/weather/production/stop`. Never erase state to hide a source restriction or coverage gap. Do not run the local PC collectors while the VM is collecting.

The public `/api/health` endpoint reports observation freshness and remains available when data request quotas are exhausted. `/api/ready` returns 503 when observations are unhealthy. The private health service also checks collector heartbeats, weather freshness (allowing a bounded refresh in progress), storage pressure, the 5 GB free-space reserve and a verified PC backup no older than 36 hours. Failures appear in `journalctl` and the systemd failed-unit list. **External alert delivery is not configured, as selected by the user.**

To enable it later, create a Healthchecks-compatible HTTPS heartbeat endpoint with a two-minute period and five-minute grace, and securely populate `/etc/mlgw/monitoring.env` from `deploy/digitalocean/monitoring.env.example` (root-owned, mode 0600). Configure delivery in that service's account. The existing health timer loads this optional file on each run and pings only when all checks pass. Keep the secret URL out of Git, logs and chat. No external endpoint/account or paid backup was created by this deployment.

## Backups, retention and recovery

The original handoff backup is saved at:

`data/deployment/backups/mlgw-2026-09-22T14-05-12-512Z.tar.gz`

Its SHA-256 is `111bce6be391bc04a126def194fed73982528f489eda8d5d537bc3e12df44278`. The adjacent JSON receipt records the download and verification. It contains the first cloud outage capture in addition to all migrated evidence. Later cloud captures require another backup.

`deploy:backup` takes a manifest snapshot of immutable archive objects, includes the application/build and saved legacy/comparison/weather evidence, then downloads the package over SSH and checks its SHA-256. It checks packaging headroom against the production reserve, hard-links immutable originals when possible and hashes files in bounded chunks. After a successful download it records a verified receipt on the VM and removes only temporary cloud packaging copies. It preserves production data and earlier PC backups. Disposable rolling weather, live SQLite, runtime PID/lease state and credentials are excluded. Rolling weather is reacquired after recovery, and SQLite is rebuilt from the canonical originals. Retain a separate protected copy of the SSH key for administration.

The Windows task **MLGW verified cloud backup** is installed for `jpbra`: daily at **10 AM Central** and at login, with three 30-minute retries and no overlapping executions. This PC must be online and the user signed in. Reinstall after moving the checkout with `deploy/digitalocean/install-pc-backup.ps1`. The latest verified receipt is `data/deployment/backups/latest.json`; immutable packages and adjacent receipts remain in that directory. Task output is `reports/scheduled-backup.log`. Inspect Task Scheduler or `Get-ScheduledTaskInfo -TaskName 'MLGW verified cloud backup'` for the result. No automatic deletion of PC backups is configured; review disk use as full backups accumulate.

For a restore rehearsal, extract a backup into an isolated directory, run `node scripts/verify-deployment.mjs <directory>`, then run `node scripts/rebuild-index.mjs <directory>/migration/data/collector <separate-empty-index-directory>` using the desired supported release and Node 24. Rebuilding verifies originals/pinned parsers, recomputes rollups and checks SQLite integrity. Production recovery uses a fresh application data directory and the deployment scripts under `deploy/digitalocean/`. Do not start collection on a restored second VM until the existing collector is stopped. After VM replacement, update the public origin, SSH host-key pin, `MLGW_BACKUP_HOST` and IP certificate for the new address.

## Routine upgrades

Run `npm ci`, `npm test`, `npm run dashboard:build` and `npm run test:browser` (after installing Playwright Chromium). `npm run deploy:release` produces a code-only bundle and SHA-256 receipt under ignored `data/deployment/`. Upload it with the pinned SSH connection, verify its checksum, extract into a new `/opt/mlgw/releases/<id>` directory and run its `scripts/verify-deployment.mjs`, Linux tests and shell syntax check before activation. Never overwrite the active release's files.

Take `npm run deploy:backup` before upgrading. For the first upgrade from an older release without the new backup tooling, set `MLGW_REMOTE_CODE=/opt/mlgw/releases/<verified-id>` for that one backup command; it still snapshots the current application/evidence. Unset this override afterward. The ordinary scheduled task uses `/opt/mlgw/current`.

From SSH, run `bash /opt/mlgw/releases/<id>/deploy/digitalocean/upgrade-release.sh /opt/mlgw/releases/<id>`. The script requires a verified PC backup less than 24 hours old, rebuilds schema 2 beside the running collector, stops writers, catches up, retains the old index/units and switches the symlink. Inspect its rebuild comparison and readiness output, then run `npm run deploy:verify`. Failed cutover automatically restores the previous release/index. Evidence and rollback artifacts remain under `/opt/mlgw/rollbacks/<id>`; retain them until the upgrade and a subsequent backup are verified.

For a later manual rollback, stop the outage/dashboard/weather/health services, restore the retained index and units, point `current` to the saved `previous-release`, then start services and verify readiness. Preserve any observations collected after the upgrade; the prior code must be able to replay their manifests before rollback is considered safe. Do not delete the archive or reset saved source restrictions. The stopped PC's schema-1 index is retained in `data/deployment/local-index-before-v2/`; its replacement reproduced all 1,635 local snapshots and collection remains stopped.

The collector has a 20 GB data budget and a 5 GB free-disk reserve. It preserves canonical originals and stops at urgent pressure; automatic deletion is disabled. Temporary duplicate capture staging is removed only after its archived copy has been checked. Weather retains the existing shared 1 GiB cap, at most 256 MiB for rolling data, four hours of radar and 24 hours of rainfall/METAR. Saved study evidence does not expire. Long-term offload and deletion of older cloud detail remain separate, uninstalled work.

## Reproducible deployment sources

- `scripts/digitalocean.mjs`: inspect/create/status through the API, with an existing-VM guard and the selected price ceiling.
- `deploy/digitalocean/cloud-init.yaml`: Ubuntu bootstrap, pinned Node release, application user and firewall.
- `scripts/prepare-deployment.mjs` / `verify-deployment.mjs`: allowlisted release/evidence bundles and per-file hashes.
- `deploy/digitalocean/install-upload.sh` / `install-release.sh`: initial installation into an empty data directory; not an in-place upgrade command.
- `deploy/digitalocean/enable-ip-https.sh`: IP certificate, Caddy configuration and renewal timer.
- `scripts/prepare-cutover.mjs` / `import-cutover.mjs` and `deploy/digitalocean/activate-cutover.sh`: final import with collection gated until local runners are stopped.
- `scripts/production-collector.mjs`, `production-weather.mjs`, `production-health.mjs`: production lifecycles and private monitoring.
- `scripts/backup-cloud.mjs`: verified backup download to this PC.

Initial bundle SHA-256: `cc63084ab51b09fe4bde390ec856acbe3a734b81030affbd657cdc5a575c0e1e`. Cutover bundle SHA-256: `bee00507961ac21177e9dc115d779eda389d6704194521b979ab1e142989189e`. Operational helpers were added after the initial release and are included in the downloaded cloud backup. Ignore generated logs, receipts, credentials, data and bundles through the existing repository ignore rules.
