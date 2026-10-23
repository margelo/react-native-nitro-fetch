import type { NitroHeader } from '../NitroFetch.nitro';
import type { RequestCache } from '../Request';

export const TEXT_CONTENT_TYPE = 'text/plain;charset=UTF-8';
export const FORM_CONTENT_TYPE =
  'application/x-www-form-urlencoded;charset=UTF-8';
// Browsers send no Content-Type for byte bodies, but Cronet rejects uploads without one.
export const BYTES_CONTENT_TYPE = 'application/octet-stream';

export function applyDefaultContentType(
  headers: NitroHeader[],
  contentType: string | undefined
): void {
  'worklet';
  if (!contentType) return;
  for (let i = 0; i < headers.length; i++) {
    if (headers[i]!.key.toLowerCase() === 'content-type') return;
  }
  headers.push({ key: 'Content-Type', value: contentType });
}

export function applyCacheHeaders(
  headers: NitroHeader[],
  cache: RequestCache | undefined
): void {
  'worklet';
  if (cache === 'no-store') {
    headers.push({ key: 'Cache-Control', value: 'no-store' });
  } else if (cache === 'no-cache') {
    headers.push({ key: 'Cache-Control', value: 'no-cache' });
  } else if (cache === 'reload') {
    headers.push({ key: 'Cache-Control', value: 'no-cache' });
    headers.push({ key: 'Pragma', value: 'no-cache' });
  }
}

function isTokenChar(c: number): boolean {
  'worklet';
  return (
    (c >= 0x61 && c <= 0x7a) ||
    (c >= 0x41 && c <= 0x5a) ||
    (c >= 0x30 && c <= 0x39) ||
    c === 0x2d ||
    c === 0x5f ||
    c === 0x2e ||
    c === 0x21 ||
    (c >= 0x23 && c <= 0x27) ||
    c === 0x2a ||
    c === 0x2b ||
    c === 0x5e ||
    c === 0x60 ||
    c === 0x7c ||
    c === 0x7e
  );
}

function isHttpWhitespace(c: number): boolean {
  'worklet';
  return c === 0x09 || c === 0x0a || c === 0x0d || c === 0x20;
}

export function normalizeAndValidateHeaders(headers: NitroHeader[]): void {
  'worklet';
  for (let i = 0; i < headers.length; i++) {
    const header = headers[i]!;
    const name = String(header.key);
    if (name.length === 0) throw new TypeError('Invalid header name: ""');
    for (let j = 0; j < name.length; j++) {
      if (!isTokenChar(name.charCodeAt(j))) {
        throw new TypeError(`Invalid header name: ${JSON.stringify(name)}`);
      }
    }
    const raw = String(header.value);
    let start = 0;
    let end = raw.length;
    while (start < end && isHttpWhitespace(raw.charCodeAt(start))) start++;
    while (end > start && isHttpWhitespace(raw.charCodeAt(end - 1))) end--;
    for (let j = start; j < end; j++) {
      const c = raw.charCodeAt(j);
      if (c === 0x00 || c === 0x0a || c === 0x0d) {
        throw new TypeError(`Invalid header value for ${JSON.stringify(name)}`);
      }
    }
    if (start !== 0 || end !== raw.length) {
      headers[i] = { key: name, value: raw.slice(start, end) };
    }
  }
}

export function headersToPairs(
  headers?: HeadersInit
): NitroHeader[] | undefined {
  'worklet';
  if (!headers) return undefined;
  const pairs: NitroHeader[] = [];
  if (headers instanceof Headers) {
    headers.forEach((v, k) => pairs.push({ key: k, value: v }));
    return pairs;
  }
  if (Array.isArray(headers)) {
    // Convert tuple pairs to objects if needed
    for (const entry of headers as any[]) {
      if (Array.isArray(entry) && entry.length >= 2) {
        pairs.push({ key: String(entry[0]), value: String(entry[1]) });
      } else if (
        entry &&
        typeof entry === 'object' &&
        'key' in entry &&
        'value' in entry
      ) {
        pairs.push(entry as NitroHeader);
      }
    }
    return pairs;
  }
  // Check if it's a plain object (Record<string, string>) first
  // Plain objects don't have forEach, so check for its absence
  if (typeof headers === 'object' && headers !== null) {
    // Check if it's a Headers instance by checking for forEach method
    const hasForEach = typeof (headers as any).forEach === 'function';

    if (hasForEach) {
      // Headers-like object (duck typing)
      (headers as any).forEach((v: string, k: string) =>
        pairs.push({ key: k, value: v })
      );
      return pairs;
    } else {
      // Plain object (Record<string, string>)
      // Use Object.keys to iterate since Object.entries might not work in worklets
      const keys = Object.keys(headers);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const v = (headers as Record<string, string>)[k];
        if (v !== undefined) {
          pairs.push({ key: k, value: String(v) });
        }
      }
      return pairs;
    }
  }
  return pairs;
}

// Pure JS version of buildNitroRequest that doesnt use anything that breaks worklets. TODO: Merge this to use Same logic for Worklets and normal Fetch
export function headersToPairsPure(
  headers?: HeadersInit
): NitroHeader[] | undefined {
  'worklet';
  if (!headers) return undefined;
  const pairs: NitroHeader[] = [];

  if (Array.isArray(headers)) {
    // Convert tuple pairs to objects if needed
    for (const entry of headers as any[]) {
      if (Array.isArray(entry) && entry.length >= 2) {
        pairs.push({ key: String(entry[0]), value: String(entry[1]) });
      } else if (
        entry &&
        typeof entry === 'object' &&
        'key' in entry &&
        'value' in entry
      ) {
        pairs.push(entry as NitroHeader);
      }
    }
    return pairs;
  }

  // Check if it's a plain object (Record<string, string>) first
  // Plain objects don't have forEach, so check for its absence
  if (typeof headers === 'object' && headers !== null) {
    // Check if it's a Headers instance by checking for forEach method
    const hasForEach = typeof (headers as any).forEach === 'function';

    if (hasForEach) {
      // Headers-like object (duck typing)
      (headers as any).forEach((v: string, k: string) =>
        pairs.push({ key: k, value: v })
      );
      return pairs;
    } else {
      // Plain object (Record<string, string>)
      // Use Object.keys to iterate since Object.entries might not work in worklets
      const keys = Object.keys(headers);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i];
        const v = (headers as Record<string, string>)[k];
        if (v !== undefined) {
          pairs.push({ key: k, value: String(v) });
        }
      }
      return pairs;
    }
  }

  return pairs;
}
