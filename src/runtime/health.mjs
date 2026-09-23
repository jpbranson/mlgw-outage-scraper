export function healthIssues({ dashboard, collector, weather, backup, freeBytes, minimumFreeBytes, now = Date.now() }) {
  const issues = [];
  if (dashboard.status !== 'ok') issues.push(`outage freshness: ${dashboard.status}`);
  for (const [name, state] of [['collector', collector], ['weather', weather]]) {
    const runningWeather = name === 'weather' && state.phase === 'refreshing' &&
      Number.isFinite(Date.parse(state.runStartedAt)) && now - Date.parse(state.runStartedAt) < 360000;
    if (!runningWeather && (!Number.isFinite(Date.parse(state.heartbeatAt)) || now - Date.parse(state.heartbeatAt) > 120000)) issues.push(`${name} heartbeat stale`);
    if (state.stopReason) issues.push(`${name} stopped: ${state.stopReason}`);
  }
  if (weather.status !== 'ok' || !Number.isFinite(Date.parse(weather.lastRun?.at)) || now - Date.parse(weather.lastRun.at) > 45 * 60000) issues.push('weather refresh degraded or stale');
  if (freeBytes < minimumFreeBytes) issues.push('disk free space below reserve');
  if (collector.storage && collector.storage.pressure !== 'ok') issues.push(`collector storage: ${collector.storage.pressure}`);
  if (backup?.verified !== true || !Number.isFinite(Date.parse(backup.downloadedAt)) || now - Date.parse(backup.downloadedAt) > 36 * 3600000) issues.push('PC backup missing or over 36 hours old; PC must be online to refresh it');
  return issues;
}

export async function monitoringHeartbeat(url, { fetchImpl = fetch } = {}) {
  if (!url) return { configured: false };
  const parsed = new URL(url);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.hash) throw Error('Monitoring endpoint must be HTTPS without credentials or a fragment');
  try {
    const response = await fetchImpl(parsed, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10000) });
    await response.body?.cancel();
    if (!response.ok) throw Error();
    return { configured: true, sent: true };
  } catch { throw Error('External monitoring heartbeat failed'); }
}
