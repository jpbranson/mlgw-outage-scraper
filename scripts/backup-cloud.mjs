import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const address = '64.225.60.118';
const options = ['-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=data/deployment/known_hosts', '-o', 'BatchMode=yes', '-i', 'data/deployment/mlgw_ed25519'];
const host = `root@${address}`, backupRoot = resolve('data/deployment/backups');
mkdirSync(backupRoot, { recursive: true });
const output = execFileSync('ssh', [...options, host, 'umask 077 && cd /opt/mlgw/current && MLGW_EXPORT_ROOT=/var/tmp/mlgw-backups /opt/node/bin/node scripts/prepare-deployment.mjs'], { encoding: 'utf8', timeout: 300000, maxBuffer: 1024 * 1024 });
const receipt = JSON.parse(output);
if (!/^[0-9TZ-]+$/.test(receipt.id) || !/^[a-f0-9]{64}$/.test(receipt.sha256) || receipt.archivePath !== `/var/tmp/mlgw-backups/mlgw-${receipt.id}.tar.gz` || receipt.stage !== `/var/tmp/mlgw-backups/release-${receipt.id}`) throw Error('Unexpected backup receipt');
const target = join(backupRoot, `mlgw-${receipt.id}.tar.gz`), partial = `${target}.part`;
if (existsSync(target) || existsSync(partial)) throw Error('Backup destination already exists');
execFileSync('scp', [...options, `${host}:${receipt.archivePath}`, partial], { stdio: 'inherit', timeout: 300000 });
const bytes = readFileSync(partial);
if (bytes.length !== receipt.bytes || createHash('sha256').update(bytes).digest('hex') !== receipt.sha256) throw Error('Downloaded backup checksum mismatch; cloud packaging retained');
renameSync(partial, target);
const saved = { ...receipt, server: address, downloadedAt: new Date().toISOString(), localPath: target, verified: true };
writeFileSync(`${target}.json`, JSON.stringify(saved, null, 2), { flag: 'wx' });
// Only verified packaging copies beneath the fixed temporary backup root are
// removed. Production data and previous backups on this PC are never deleted.
execFileSync('ssh', [...options, host, `rm -rf -- /var/tmp/mlgw-backups/release-${receipt.id} /var/tmp/mlgw-backups/mlgw-${receipt.id}.tar.gz`], { stdio: 'inherit', timeout: 30000 });
console.log(JSON.stringify({ localPath: target, sha256: receipt.sha256, bytes: receipt.bytes, archiveAttempts: receipt.archiveAttempts, verified: true }));
