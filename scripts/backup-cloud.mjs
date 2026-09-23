import { writeFileSync, mkdirSync, existsSync, renameSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileHash } from '../src/runtime/file-hash.mjs';
import { writeAtomic } from '../src/runtime/durable-files.mjs';
import { processLock } from '../src/runtime/process-lock.mjs';
const address = process.env.MLGW_BACKUP_HOST ?? '64.225.60.118';
if (!/^[a-zA-Z0-9.-]+$/.test(address)) throw Error('Invalid backup host');
const remoteCode = process.env.MLGW_REMOTE_CODE ?? '/opt/mlgw/current';
if (!/^\/opt\/mlgw\/(current|releases\/[a-zA-Z0-9_-]+)$/.test(remoteCode)) throw Error('Invalid remote code directory');
const options = ['-o', 'StrictHostKeyChecking=yes', '-o', 'UserKnownHostsFile=data/deployment/known_hosts', '-o', 'BatchMode=yes', '-i', 'data/deployment/mlgw_ed25519'];
const host = `root@${address}`, backupRoot = resolve('data/deployment/backups');
mkdirSync(backupRoot, { recursive: true });
const unlock = processLock(join(backupRoot, 'backup.lock'));
try {
const output = execFileSync('ssh', [...options, host, `umask 077 && cd /opt/mlgw/current && MLGW_EXPORT_ROOT=/var/tmp/mlgw-backups /opt/node/bin/node ${remoteCode}/scripts/prepare-deployment.mjs`], { encoding: 'utf8', timeout: 3600000, maxBuffer: 1024 * 1024 });
const receipt = JSON.parse(output);
if (!/^[0-9TZ-]+$/.test(receipt.id) || !/^[a-f0-9]{64}$/.test(receipt.sha256) || receipt.archivePath !== `/var/tmp/mlgw-backups/mlgw-${receipt.id}.tar.gz` || receipt.stage !== `/var/tmp/mlgw-backups/release-${receipt.id}`) throw Error('Unexpected backup receipt');
const target = join(backupRoot, `mlgw-${receipt.id}.tar.gz`), partial = `${target}.part`;
if (existsSync(target) || existsSync(partial)) throw Error('Backup destination already exists');
execFileSync('scp', [...options, `${host}:${receipt.archivePath}`, partial], { stdio: 'inherit', timeout: 3600000 });
const actual = fileHash(partial);
if (actual.bytes !== receipt.bytes || actual.sha256 !== receipt.sha256) throw Error('Downloaded backup checksum mismatch; cloud packaging retained');
renameSync(partial, target);
const saved = { ...receipt, server: address, downloadedAt: new Date().toISOString(), localPath: target, verified: true };
writeFileSync(`${target}.json`, JSON.stringify(saved, null, 2), { flag: 'wx' });
writeAtomic(join(backupRoot,'latest.json'),JSON.stringify(saved,null,2));
const cloudReceipt = {id:receipt.id,sha256:receipt.sha256,bytes:receipt.bytes,downloadedAt:saved.downloadedAt,verified:true};
// A receipt is acknowledged only after the off-host copy is fully verified.
execFileSync('ssh',[...options,host,`cd /opt/mlgw/current && /opt/node/bin/node ${remoteCode}/scripts/record-backup.mjs`],{input:JSON.stringify(cloudReceipt),timeout:30000});
// Only verified packaging copies beneath the fixed temporary backup root are
// removed. Production data and previous backups on this PC are never deleted.
execFileSync('ssh', [...options, host, `rm -rf -- /var/tmp/mlgw-backups/release-${receipt.id} /var/tmp/mlgw-backups/mlgw-${receipt.id}.tar.gz`], { stdio: 'inherit', timeout: 30000 });
console.log(JSON.stringify({ localPath: target, sha256: receipt.sha256, bytes: receipt.bytes, archiveAttempts: receipt.archiveAttempts, verified: true }));
} finally { unlock(); }
