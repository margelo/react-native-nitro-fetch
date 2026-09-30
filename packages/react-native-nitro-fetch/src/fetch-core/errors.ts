export function createAbortError(signal?: AbortSignal | null): unknown {
  if (signal?.aborted && signal.reason !== undefined) return signal.reason;
  const err = new Error('The operation was aborted.');
  err.name = 'AbortError';
  return err;
}
