export function logError(operation, error, context = {}) {
  console.error(JSON.stringify({ at: new Date().toISOString(), level: 'error', operation, ...context,
    error: String(error?.message ?? error).slice(0, 1000), code: error?.code ?? null }));
}
