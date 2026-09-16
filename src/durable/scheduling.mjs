import { setTimeout as sleep } from 'node:timers/promises';
import { INTERVAL_MS } from './rollups.mjs';

export function retryDecision(record, attempt, now = Date.now()) {
  if (record.stopReason || [401, 403].includes(record.feed?.status)) return { action: 'stop', reason: record.stopReason ?? 'Source access restricted' };
  if (record.retryAt || record.feed?.status === 429 || record.html?.status === 429) {
    return { action: 'backoff', until: Math.max(now + INTERVAL_MS, Date.parse(record.retryAt ?? '') || now) };
  }
  const status = record.feed?.status;
  const transient = status == null || status === 408 || status >= 500;
  if (transient && attempt < 2) return { action: 'retry' };
  return { action: 'next_slot' };
}

export async function collectWithRetries({ capture, publish, slot, sleepImpl = sleep, random = Math.random, now = Date.now }) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const record = await capture(slot);
    await publish(record);
    const decision = retryDecision(record, attempt, now());
    if (decision.action !== 'retry') return { record, decision, attempts: attempt + 1 };
    await sleepImpl(500 * 2 ** attempt + Math.floor(random() * 500));
  }
}

export function pilotMode(pilot, now = Date.now()) {
  if (!pilot) return { mode: 'capture' };
  if (pilot.stopReason) return { mode: 'stop', reason: pilot.stopReason };
  if (Date.parse(pilot.retryAt) > now) return { mode: 'backoff', until: Date.parse(pilot.retryAt) };
  // The Phase 1 collector owns its window. Do not issue parallel source polls.
  if (!pilot.completedAt && now <= Date.parse(pilot.endsAt) + INTERVAL_MS) return { mode: 'mirror' };
  return { mode: 'capture' };
}
