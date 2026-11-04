import type { NitroHeader } from './NitroFetch.nitro';

/** Anything `new Headers()` accepts: an object, a list of pairs, or another `Headers`. */
export type HeadersInitInput =
  | NitroHeaders
  | NitroHeader[]
  | [string, string][]
  | Record<string, string>
  | Headers
  | undefined;

function normalizeName(name: string): string {
  return name.toLowerCase();
}

/** A list of HTTP headers. Works like the standard `Headers`, and names are not case-sensitive. */
export class NitroHeaders {
  private _map: Map<string, string[]>;

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
        this._map.set(normalizeName(key), [value]);
      });
    } else if (Array.isArray(init)) {
      for (const entry of init) {
        if (Array.isArray(entry) && entry.length >= 2) {
          // [string, string] tuple
          const key = normalizeName(String(entry[0]));
          const value = String(entry[1]);
          const existing = this._map.get(key);
          if (existing) existing.push(value);
          else this._map.set(key, [value]);
        } else if (
          entry &&
          typeof entry === 'object' &&
          'key' in entry &&
          'value' in entry
        ) {
          // NitroHeader object
          const key = normalizeName((entry as NitroHeader).key);
          const value = (entry as NitroHeader).value;
          const existing = this._map.get(key);
          if (existing) existing.push(value);
          else this._map.set(key, [value]);
        }
      }
    } else if (typeof init === 'object' && init !== null) {
      const keys = Object.keys(init as Record<string, string>);
      for (let i = 0; i < keys.length; i++) {
        const k = keys[i]!;
        const v = (init as Record<string, string>)[k];
        if (v !== undefined) {
          this._map.set(normalizeName(k), [String(v)]);
        }
      }
    }
  }

  /** Adds a value, keeping any values already set for `name`. */
  append(name: string, value: string): void {
    const key = normalizeName(name);
    const existing = this._map.get(key);
    if (existing) existing.push(value);
    else this._map.set(key, [value]);
  }

  /** Removes a header. */
  delete(name: string): void {
    this._map.delete(normalizeName(name));
  }

  /** Gets a header's values joined with `, `, or `null` if it isn't set. */
  get(name: string): string | null {
    const values = this._map.get(normalizeName(name));
    if (!values || values.length === 0) return null;
    return values.join(', ');
  }

  /** Gets each `Set-Cookie` value separately. */
  getSetCookie(): string[] {
    return this._map.get('set-cookie') ?? [];
  }

  /** Whether a header is set. */
  has(name: string): boolean {
    return this._map.has(normalizeName(name));
  }

  /** Sets a header, replacing any values it had. */
  set(name: string, value: string): void {
    this._map.set(normalizeName(name), [value]);
  }

  /** Calls `callback` for each header, sorted by name. */
  forEach(
    callback: (value: string, key: string, headers: NitroHeaders) => void,
    thisArg?: any
  ): void {
    const sortedKeys = Array.from(this._map.keys()).sort();
    for (const key of sortedKeys) {
      callback.call(thisArg, this._map.get(key)!.join(', '), key, this);
    }
  }

  /** Each `[name, value]` pair, sorted by name. */
  entries(): HeadersIterator<[string, string]> {
    const map = this._map;
    const sortedKeys = Array.from(map.keys()).sort();
    function* gen(): Generator<[string, string]> {
      for (const key of sortedKeys) {
        yield [key, map.get(key)!.join(', ')];
      }
    }
    return gen() as unknown as HeadersIterator<[string, string]>;
  }

  /** Each header name, sorted. */
  keys(): HeadersIterator<string> {
    const map = this._map;
    const sortedKeys = Array.from(map.keys()).sort();
    function* gen(): Generator<string> {
      for (const key of sortedKeys) {
        yield key;
      }
    }
    return gen() as unknown as HeadersIterator<string>;
  }

  /** Each header value, sorted by name. */
  values(): HeadersIterator<string> {
    const map = this._map;
    const sortedKeys = Array.from(map.keys()).sort();
    function* gen(): Generator<string> {
      for (const key of sortedKeys) {
        yield map.get(key)!.join(', ');
      }
    }
    return gen() as unknown as HeadersIterator<string>;
  }

  [Symbol.iterator](): HeadersIterator<[string, string]> {
    return this.entries();
  }
}
