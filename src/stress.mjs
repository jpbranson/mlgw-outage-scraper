// Deterministic, deliberately varied synthetic inputs, never real storm history.
export function makeStressFeed(seedFeed, count) {
  if (!seedFeed.features?.length) throw new Error('Stress generation needs a nonempty real fixture');
  let state = 82731;
  const random = () => ((state = (1664525 * state + 1013904223) >>> 0) / 4294967296);
  const features = Array.from({ length: count }, (_, i) => {
    const source = structuredClone(seedFeed.features[i % seedFeed.features.length]);
    source.id = i + 1;
    source.properties.OUTAGE_NO = 8000000 + i;
    source.properties.CUR_CUST_AFF = 1 + Math.floor(random() ** 3 * 300);
    source.properties.TIME_STAMP = `09/${String(14 + i % 3).padStart(2, '0')}/2026 ${String(1 + i % 12).padStart(2, '0')}:${String(Math.floor(random() * 60)).padStart(2, '0')}:${String(Math.floor(random() * 60)).padStart(2, '0')} ${i % 2 ? 'AM' : 'PM'}`;
    source.geometry.coordinates = [Number((-90.25 + random() * 0.6).toFixed(5)), Number((35 + random() * 0.4).toFixed(5))];
    return source;
  });
  return { type: 'FeatureCollection', features };
}

export function storageModel(quietBytes, stormBytes, intervalMinutes) {
  const perDay = 1440 / intervalMinutes;
  // Seven storm days in the protected year; ALL 30 offline days at storm load.
  // Staging one seven-day storm bundle and seven days of cleanup grace are additive.
  const protectedYear = ((365 - 7) * quietBytes + 7 * stormBytes) * perDay;
  const offline30Days = 30 * stormBytes * perDay;
  const transferStaging = 7 * stormBytes * perDay;
  const cleanupGrace = 7 * stormBytes * perDay;
  return { intervalMinutes, protectedYear, offline30Days, transferStaging, cleanupGrace,
    totalBytes: protectedYear + offline30Days + transferStaging + cleanupGrace,
    within10GBBeforeOtherAccountUsage: protectedYear + offline30Days + transferStaging + cleanupGrace < 1e10 };
}
