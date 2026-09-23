import { MAX_GAP_MS } from './rollups.mjs';

export const PROJECTION_VERSION = 'outage-projection-v2';

// Count validity is independent of geometry, source-time confidence and additive
// schema warnings. A contradictory HTML zero check remains a blocking review.
export function captureFacts(parsed, htmlSummary) {
  const flags = [...(parsed?.issues ?? [])];
  let quality = !parsed ? 'failed' : parsed.totalsValid ? 'valid' : 'invalid';
  const htmlCustomers = htmlSummary?.customers ?? null;
  if (htmlCustomers != null && parsed?.totals.customers != null && htmlCustomers !== parsed.totals.customers) {
    flags.push({ code: 'html_customer_mismatch' });
    if (parsed.totals.customers === 0) quality = 'review';
  }
  return { quality, flags, htmlCustomers };
}

export function classifyCandidate(fact, previous) {
  const flags = JSON.parse(fact.flags_json);
  let quality = fact.base_quality;
  if (quality === 'valid' && fact.customers === 0 && previous &&
      (previous.customers >= 100 || previous.quality === 'quarantined') && fact.html_customers !== 0) {
    const confirmed = previous.quality === 'quarantined' && previous.customers === 0 &&
      fact.received_ms - previous.captured_ms <= MAX_GAP_MS;
    if (!confirmed) { quality = 'quarantined'; flags.push({ code: 'unconfirmed_zero' }); }
  }
  return { quality, flags };
}
