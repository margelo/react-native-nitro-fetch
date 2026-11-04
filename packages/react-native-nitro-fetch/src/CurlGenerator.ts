/** The request to turn into a `curl` command. */
export interface CurlOptions {
  url: string;
  /** Left out of the command when it is `'GET'`. */
  method: string;
  /** Each becomes a `-H` option. */
  headers?: Array<{ key: string; value: string }>;
  /** Cut to 10,000 characters. */
  body?: string;
  /** Adds `-v`. */
  verbose?: boolean;
  /** Adds `--compressed`. */
  compressed?: boolean;
}

function shellEscape(str: string): string {
  if (/^[a-zA-Z0-9._\-/:=@,+]+$/.test(str)) return str;
  return "'" + str.replace(/'/g, "'\\''") + "'";
}

/** Writes a request as a `curl` command you can paste into a terminal. Leaves out the `prefetchKey` header. */
export function generateCurl(options: CurlOptions): string {
  const parts: string[] = ['curl'];

  if (options.method && options.method !== 'GET') {
    parts.push('-X', shellEscape(options.method));
  }

  if (options.headers) {
    for (const h of options.headers) {
      if (h.key.toLowerCase() === 'prefetchkey') continue;
      parts.push('-H', shellEscape(`${h.key}: ${h.value}`));
    }
  }

  if (options.body) {
    const maxLen = 10_000;
    const truncated =
      options.body.length > maxLen
        ? options.body.slice(0, maxLen) + '...[truncated]'
        : options.body;
    parts.push('-d', shellEscape(truncated));
  }

  if (options.verbose) parts.push('-v');
  if (options.compressed) parts.push('--compressed');

  parts.push(shellEscape(options.url));

  return parts.join(' ');
}
