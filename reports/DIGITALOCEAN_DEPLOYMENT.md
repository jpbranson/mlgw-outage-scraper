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
| Application | `/opt/mlgw/current` → `/opt/mlgw/releases/2026-09-22T13-42-01-258Z` |
| Persistent data | `/var/lib/mlgw/data`; release `data` is a symlink here |
| Dashboard | `127.0.0.1:4173`, served publicly through Caddy |
| Outage schedule | Five minutes; continuous production state, no trial deadline |
| Weather schedule | Thirty minutes; continuous production state, no trial deadline |
| HTTPS | Let's Encrypt IP certificate, automatic renewal checked twice daily |
| Health checks | Every two minutes, recorded in the system journal |

Paid DigitalOcean backups and extra storage products are not enabled. The account token remains in ignored local `data/deployment/digitalocean-token.txt`; it was not included in any upload. Runtime collection and SSH do not depend on that token. The SSH private key is `data/deployment/mlgw_ed25519`, with a restricted Windows ACL. Keep the key and token out of Git and chat.

## Verified handoff and operation

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

At the initial operating check, the VM had about **44 GiB free disk space** and **1.2 GiB available RAM**. Measured service memory peaks were approximately 97 MiB for the dashboard, 48 MiB for the collector and 277 MiB for weather. These are observed light-load measurements, not a stress or uptime guarantee. Browser automation was unavailable in this session; the public HTTP verifier exercised the already-built dashboard endpoints.

**Documentation audit, September 22 at 16:26 UTC:** read-only checks confirmed that the dashboard, both collectors, Caddy, health timer and certificate timer were active; application services and timers were enabled at boot. Public health was `ok` with the 16:25:22 UTC capture, and the private health check reported no issues. About 44 GiB remained free. This audit did not restart services or rerun the deployment tests.

## September 22 archive compatibility repair

At 4:10 PM CDT (21:10 UTC), the outage collector encountered an empty feed identical to one migrated from Windows. Its gzip header differed from Linux's encoding by one OS metadata byte. The archive writer compared compressed bytes even though the object key identifies the uncompressed original, raised `Immutable object conflict`, and repeatedly failed during startup recovery. The dashboard continued serving the 4:05 PM capture; weather collection remained active.

The repair preserves an existing gzip file when bounded decompression matches the original exactly, reports its actual stored size, and retains strict byte comparisons for manifests/parsers. Corrupt or mismatched originals still fail. All **192 Node tests passed locally**, including five added regression tests; **30 archive, durable collector and production tests passed on the Linux VM** before deployment.

The active release's `src/durable/archive.mjs` was patched at **10:14 PM CDT on September 22 (03:14 UTC September 23)** and only the outage collector was restarted. The pending 4:10 PM capture was recovered with verified detail. Fresh captures published at **10:14:30 PM** and the next scheduled **10:15:01 PM CDT**. All **30 public HTTPS checks passed**, and the private health check returned `ok` with no issues. The conflicting archived gzip retained its exact checksum. The approximately six-hour interval without observations remains a collection gap; recovery does not invent missing captures.

The deployment record, Linux test log, prior module and prior collector state are retained in `/opt/mlgw/hotfixes/2026-09-23-archive-gzip/`. The installed module's SHA-256 is `8900a042322f99bf4052d8de1af70a4cbee3ec836bac3789d5f1c55b2eaa9398`. The prior module is `archive.mjs.before`; no canonical archive objects were replaced or removed.

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

The public health endpoint reports observation freshness. The private health service also checks collector heartbeats, weather freshness and the 5 GB free-space reserve. Failures appear in `journalctl` and the systemd failed-unit list. **External alert delivery is not configured.**

## Backups, retention and recovery

The verified backup is saved at:

`data/deployment/backups/mlgw-2026-09-22T14-05-12-512Z.tar.gz`

Its SHA-256 is `111bce6be391bc04a126def194fed73982528f489eda8d5d537bc3e12df44278`. The adjacent JSON receipt records the download and verification. It contains the first cloud outage capture in addition to all migrated evidence. Later cloud captures require another backup.

`deploy:backup` takes a manifest snapshot of immutable archive objects, includes the application/build and saved legacy/comparison/weather evidence, then downloads the package over SSH and checks its SHA-256. After a successful download it removes only the temporary cloud packaging copies. It preserves production data and earlier PC backups. Disposable rolling weather, live SQLite, runtime PID/lease state and credentials are excluded. Rolling weather is reacquired after recovery, and SQLite is rebuilt from the canonical originals. **Backups are currently on demand; recurring off-VM backup scheduling is not installed.** Retain a separate protected copy of the SSH key for administration.

For a restore rehearsal, extract a backup into an isolated directory, run `node scripts/verify-deployment.mjs <directory>`, link/copy its `migration/data` as `data`, and run `node scripts/restore-production.mjs` with Node 24. Production recovery uses a fresh application data directory and the deployment scripts under `deploy/digitalocean/`. Do not start collection on a restored second VM until the existing collector is stopped. After VM replacement, update the public origin, SSH host-key pin, backup host setting and IP certificate for the new address.

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
