export function validateCollectorConfig(config, expectedMode) {
  const keys = new Set(['mode', 'root', 'pilotDirectory', 'runDays', 'pollIntervalMs', 'checkIntervalMs',
    'localBudgetBytes', 'minimumFreeDiskBytes', 'warningFraction', 'offloadFraction', 'urgentFraction',
    'automaticDeletion', 'protectedYearDays', 'offlineReserveDays']);
  if (Object.keys(config).some(key => !keys.has(key))) throw Error('Unknown collector configuration key');
  if (config.mode !== expectedMode || typeof config.root !== 'string' || !config.root || config.pollIntervalMs !== 300000 ||
      config.automaticDeletion !== false) throw Error('Unsupported collector configuration');
  if (!Number.isInteger(config.checkIntervalMs) || config.checkIntervalMs < 1000 || config.checkIntervalMs > 60000 ||
      !Number.isSafeInteger(config.localBudgetBytes) || config.localBudgetBytes <= 0 ||
      !Number.isSafeInteger(config.minimumFreeDiskBytes) || config.minimumFreeDiskBytes < 0 ||
      !(0 < config.warningFraction && config.warningFraction < config.offloadFraction &&
        config.offloadFraction < config.urgentFraction && config.urgentFraction < 1)) throw Error('Invalid collector limits');
  if (config.protectedYearDays !== 365 || config.offlineReserveDays !== 30) throw Error('Unsupported retention policy; automatic offload is not installed');
  return config;
}
