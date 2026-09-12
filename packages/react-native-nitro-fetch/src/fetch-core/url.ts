// http(s) -> native client; anything else is a local resource (hot path).
export function isHttpUrl(url: string): boolean {
  if (url.startsWith('http://') || url.startsWith('https://')) return true;
  const c = url.charCodeAt(0);
  if (c !== 104 && c !== 72) return false; // not 'h'/'H'
  return /^https?:/i.test(url);
}

export function getUrlString(input: RequestInfo | URL): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.toString();
  const u = (input as { url?: unknown } | null)?.url;
  return typeof u === 'string' ? u : String(input);
}
