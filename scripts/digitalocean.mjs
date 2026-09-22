// Account credentials stay on the operator's PC and are never bundled for upload.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
const mode = process.argv[2] ?? 'inspect';
if (!['inspect', 'create', 'status'].includes(mode)) throw Error('Use inspect, create or status');
const directory = resolve('data/deployment'); mkdirSync(directory, { recursive: true });
const token = (process.env.DIGITALOCEAN_ACCESS_TOKEN ?? readFileSync(join(directory, 'digitalocean-token.txt'), 'utf8')).trim();
if (!/^dop_v1_[A-Za-z0-9]+$/.test(token)) throw Error('Expected a DigitalOcean personal access token in the local credential file');
async function api(path, body) {
  const response = await fetch(`https://api.digitalocean.com/v2/${path}`, {
    method: body ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(60000),
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const data = await response.json();
  if (!response.ok) throw Error(`DigitalOcean ${response.status}: ${String(data.message ?? data.id ?? 'Request failed').replaceAll(token, '[redacted]')}`);
  return data;
}
const statePath = join(directory, 'digitalocean.json');
if (mode === 'status') {
  const state = JSON.parse(readFileSync(statePath));
  const { droplet } = await api(`droplets/${state.id}`);
  const ipv4 = droplet.networks.v4.find(n => n.type === 'public')?.ip_address;
  const result = { ...state, status: droplet.status, ipv4: ipv4 ?? null };
  writeFileSync(statePath, JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
} else {
  const [sizeData, regionData, imageData, dropletData] = await Promise.all([
    api('sizes?per_page=200'), api('regions?per_page=200'), api('images?type=distribution&per_page=200'), api('droplets?per_page=200')
  ]);
  const name = 'mlgw-outage-prod', size = sizeData.sizes.find(s => s.slug === 's-1vcpu-2gb');
  if (!size?.available || size.price_monthly > 12 || size.memory !== 2048 || size.disk < 50) throw Error('The authorized 2 GB / 50 GB / $12 plan is unavailable');
  const regions = regionData.regions.filter(r => r.available && size.regions.includes(r.slug));
  const region = ['nyc3', 'nyc1', 'atl1', 'sfo3'].find(slug => regions.some(r => r.slug === slug));
  const image = imageData.images.find(i => i.slug === 'ubuntu-24-04-x64' && i.regions.includes(region));
  if (!region || !image) throw Error('Expected Ubuntu 24.04 image/region unavailable');
  const existing = dropletData.droplets.filter(d => d.name === name);
  const specification = { name, size: size.slug, region, image: image.slug, monthlyUsd: size.price_monthly, memoryMiB: size.memory, diskGiB: size.disk };
  if (mode === 'inspect') console.log(JSON.stringify({ specification, existing: existing.map(d => ({ id: d.id, name: d.name, status: d.status })), availableRegions: regions.map(r => r.slug) }, null, 2));
  else {
    if (existsSync(statePath)) throw Error('A deployment receipt already exists; inspect status instead of creating another VM');
    if (existing.length) throw Error('A VM with the deployment name already exists; inspect it before creating another');
    const privateKey = join(directory, 'mlgw_ed25519');
    if (!existsSync(privateKey)) execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', '', '-C', 'mlgw-deployment', '-f', privateKey], { stdio: 'pipe' });
    if (process.platform === 'win32') execFileSync('icacls', [privateKey, '/inheritance:r', '/grant:r', `${process.env.USERDOMAIN}\\${process.env.USERNAME}:(R,W)`], { stdio: 'pipe' });
    const publicKey = readFileSync(privateKey + '.pub', 'utf8').trim();
    const keys = (await api('account/keys?per_page=200')).ssh_keys;
    let key = keys.find(k => k.public_key.split(' ').slice(0, 2).join(' ') === publicKey.split(' ').slice(0, 2).join(' '));
    if (!key) key = (await api('account/keys', { name: 'mlgw-deployment', public_key: publicKey })).ssh_key;
    const userData = readFileSync('deploy/digitalocean/cloud-init.yaml', 'utf8');
    // No retry of this POST: an ambiguous timeout requires inspecting the account.
    const { droplet } = await api('droplets', { name, region, size: size.slug, image: image.slug,
      ssh_keys: [key.fingerprint], backups: false, ipv6: true, monitoring: true, user_data: userData });
    const state = { ...specification, id: droplet.id, sshKeyId: key.id, createdAt: droplet.created_at, status: droplet.status };
    writeFileSync(statePath, JSON.stringify(state, null, 2), { flag: 'wx' }); console.log(JSON.stringify(state));
  }
}
