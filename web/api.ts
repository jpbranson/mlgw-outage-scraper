export async function api<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(path, { signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error ?? 'Unable to read the archive.');
  return data as T;
}
