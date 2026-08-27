import type { NitroHeader } from './NitroFetch.nitro';

type HeadersInitInput =
  | NitroHeaders
  | NitroHeader[]
  | [string, string][]
  | Record<string, string>
  | Headers
  | undefined;

function normalizeName(name: string): string {
  const value = String(name);
  if (!/^[!#$%&'*+.^_`|~0-9a-z-]+$/i.test(value)) {
    throw new TypeError('Invalid header name.');
  }
  return value.toLowerCase();
}

function normalizeValue(value: string): string {
  const normalized = String(value).replace(/^[\t\n\r ]+|[\t\n\r ]+$/g, '');
  if (/[\0\r\n\u0100-\uffff]/.test(normalized)) {
    throw new TypeError('Invalid header value.');
  }
  return normalized;
}

export class NitroHeaders {
  private _map: Map<string, string[]>;
  private _sortedEntries: [string, string][] | undefined;

  constructor(init?: HeadersInitInput) {
    this._map = new Map();
    if (!init) return;

    if (init instanceof NitroHeaders) {
      init._map.forEach((values, key) => {
        this._map.set(key, [...values]);
      });
    } else if (
      typeof init === 'object' &&
      !Array.isArray(init) &&
      typeof (init as any).forEach === 'function' &&
      typeof (init as any).get === 'function'
    ) {
      // Headers-like object (standard Headers or duck-typed)
      (init as any).forEach((value: string, key: string) => {
        this.append(key, value);
      });
    } else if (Array.isArray(init)) {
      for (const entry of init) {
        if (Array.isArray(entry) && entry.length === 2) {
          // [string, string] tuple
          this.append(entry[0], entry[1]);
        } else if (
          entry &&
          typeof entry === 'object' &&
          'key' in entry &&
          'value' in entry
        ) {
          // NitroHeader object
          this.append(entry.key, entry.value);
        } else {
          throw new TypeError('Headers entries must contain a name and value.');
        }
      }
    } else if (typeof init === 'object' && init !== null) {
      const keys = Object.keys(init as Record<string, string>);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]!;
        const v = (init as Record<string, string>)[k];
        this.append(k, String(v));
      }
    }
  }

  append(name: string, value: string): void {
    const key = normalizeName(name);
    const normalized = normalizeValue(value);
    const existing = this._map.get(key);
    if (existing) existing.push(normalized);
    else this._map.set(key, [normalized]);
    this._sortedEntries = undefined;
  }

  delete(name: string): void {
    if (this._map.delete(normalizeName(name))) {
      this._sortedEntries = undefined;
    }
  }

  get(name: string): string | null {
    const values = this._map.get(normalizeName(name));
    if (!values || values.length === 0) return null;
    return values.join(', ');
  }

  getSetCookie(): string[] {
    return [...(this._map.get('set-cookie') ?? [])];
  }

  has(name: string): boolean {
    return this._map.has(normalizeName(name));
  }

  set(name: string, value: string): void {
    this._map.set(normalizeName(name), [normalizeValue(value)]);
    this._sortedEntries = undefined;
  }

  private _entries(): [string, string][] {
    if (this._sortedEntries) return this._sortedEntries;
    const entries: [string, string][] = [];
    for (const key of Array.from(this._map.keys()).sort()) {
      const values = this._map.get(key)!;
      if (key === 'set-cookie') {
        for (const value of values) entries.push([key, value]);
      } else {
        entries.push([key, values.join(', ')]);
      }
    }
    this._sortedEntries = entries;
    return entries;
  }

  forEach(
    callback: (value: string, key: string, headers: NitroHeaders) => void,
    thisArg?: any
  ): void {
    for (const [key, value] of this.entries()) {
      callback.call(thisArg, value, key, this);
    }
  }

  entries(): HeadersIterator<[string, string]> {
    function* gen(headers: NitroHeaders): Generator<[string, string]> {
      for (let index = 0; ; index++) {
        // Re-read after a mutation: Headers iterators are live, not snapshots.
        const entry = headers._entries()[index];
        if (!entry) return;
        yield [entry[0], entry[1]];
      }
    }
    return gen(this) as unknown as HeadersIterator<[string, string]>;
  }

  keys(): HeadersIterator<string> {
    const entries = this.entries();
    function* gen(): Generator<string> {
      for (const [key] of entries) {
        yield key;
      }
    }
    return gen() as unknown as HeadersIterator<string>;
  }

  values(): HeadersIterator<string> {
    const entries = this.entries();
    function* gen(): Generator<string> {
      for (const [, value] of entries) {
        yield value;
      }
    }
    return gen() as unknown as HeadersIterator<string>;
  }

  [Symbol.iterator](): HeadersIterator<[string, string]> {
    return this.entries();
  }
}
