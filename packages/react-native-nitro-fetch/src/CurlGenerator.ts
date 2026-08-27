export interface CurlOptions {
  url: string;
  method: string;
  headers?: Array<{ key: string; value: string }>;
  body?: string;
  verbose?: boolean;
  compressed?: boolean;
}

function shellEscape(str: string): string {
  if (/^[a-zA-Z0-9._\-/:=@,+]+$/.test(str)) return str;
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

export function generateCurl(options: CurlOptions): string {
  const parts: string[] = ['curl'];

  if (options.method && (options.method !== 'GET' || options.body != null)) {
    parts.push('-X', shellEscape(options.method));
  }

  if (options.headers) {
    for (const h of options.headers) {
      if (h.key.toLowerCase() === 'prefetchkey') continue;
      parts.push('-H', shellEscape(`${h.key}: ${h.value}`));
    }
  }

  if (options.body != null) {
    parts.push('--data-raw', shellEscape(options.body));
  }

  if (options.verbose) parts.push('-v');
  if (options.compressed) parts.push('--compressed');

  parts.push('--url', shellEscape(options.url));

  return parts.join(' ');
}
