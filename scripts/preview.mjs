import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createPreviewGateway, passwordDigest } from '../src/dashboard/preview-gateway.mjs';

const directory = resolve('data/remote-preview'), statePath = join(directory, 'state.json');
mkdirSync(directory, { recursive: true });
function loadState() { try { return JSON.parse(readFileSync(statePath, 'utf8')); } catch { return null; } }
function running(pid) { if (!Number.isSafeInteger(pid)) return false; try { process.kill(pid, 0); return true; } catch { return false; } }
const command = process.argv[2] ?? 'start';
if (command === 'status') {
  const state = loadState();
  // Status never prints the credential. It is provided separately to the owner.
  console.log(JSON.stringify(state ? { ...state, running: running(state.pid) } : { running: false }, null, 2));
} else if (command === 'stop') {
  // The owner process observes this marker and stops its own child safely.
  writeFileSync(join(directory, 'stop-requested'), new Date().toISOString());
  console.log('Stop requested for the temporary preview only.');
} else if (command === 'start') {
  const old = loadState();
  if (old && running(old.pid) && old.status !== 'stopped') throw new Error('A preview process is already running.');
  const binary = resolve('data/tools/cloudflared.exe');
  if (!existsSync(binary)) throw new Error('Download and verify the official cloudflared executable first.');
  const health = await fetch('http://127.0.0.1:4173/api/health', { signal: AbortSignal.timeout(5000) });
  if (!health.ok) throw new Error('Local dashboard is unavailable.');
  const password = randomBytes(18).toString('base64url'), started = Date.now(), expires = started + 8 * 3600000;
  writeFileSync(join(directory, 'credentials.json'), JSON.stringify({ password, expiresAt: new Date(expires).toISOString() }, null, 2));
  let publicOrigin = null, stopping = false;
  const state = { pid: process.pid, tunnelPid: null, startedAt: new Date(started).toISOString(), expiresAt: new Date(expires).toISOString(), url: null, status: 'starting' };
  const save = () => { writeFileSync(statePath + '.tmp', JSON.stringify(state, null, 2)); renameSync(statePath + '.tmp', statePath); };
  const gateway = createPreviewGateway({ passwordHash: passwordDigest(password), getOrigin: () => publicOrigin, expiresAt: expires });
  gateway.listen(4174, '127.0.0.1'); await once(gateway, 'listening'); save();
  const tunnel = spawn(binary, ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', 'http://127.0.0.1:4174', '--http-host-header', '127.0.0.1:4174', '--metrics', '127.0.0.1:4175'],
    { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
  state.tunnelPid = tunnel.pid; save();
  let text = '';
  function output(chunk) {
    const line = chunk.toString(); process.stdout.write(line);
    text = (text + line).slice(-16000);
    const match = text.match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match && !publicOrigin) { publicOrigin = match[0]; state.url = publicOrigin; state.status = 'connecting'; save(); }
    if (line.includes('Registered tunnel connection') && state.status !== 'connected') { state.status = 'connected'; save(); }
  }
  tunnel.stdout.on('data', output); tunnel.stderr.on('data', output);
  function stop(reason) {
    if (stopping) return; stopping = true;
    state.status = 'stopped'; state.stopReason = reason; save();
    clearInterval(check); tunnel.kill(); gateway.closeAllConnections(); gateway.close();
    console.log(`Preview stopped: ${reason}`);
  }
  const check = setInterval(() => {
    const stopPath = join(directory, 'stop-requested');
    if (Date.now() >= expires) stop('eight_hour_expiry');
    else if (existsSync(stopPath) && Date.parse(readFileSync(stopPath, 'utf8')) >= started) stop('owner_requested');
    else if (state.status !== 'connected' && Date.now() - started > 120000) stop('startup_timeout');
  }, 1000);
  tunnel.on('error', () => stop('tunnel_launch_failed'));
  tunnel.on('exit', () => stop('tunnel_exited'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop('interrupted'));
} else throw new Error('Use start, status or stop.');
