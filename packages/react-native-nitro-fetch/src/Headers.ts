import type { NitroHeader } from './NitroFetch.nitro';

type HeadersInitInput =
  | NitroHeaders
  | NitroHeader[]
  | [string, string][]
  | Record<string, string>
  | Headers
  | undefined;

function normalizeName(name: string): string {
  return name.toLowerCase();
}

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

  append(name: string, value: string): void {
    const key = normalizeName(name);
    const existing = this._map.get(key);
    if (existing) existing.push(value);
    else this._map.set(key, [value]);
  }

  delete(name: string): void {
    this._map.delete(normalizeName(name));
  }

  get(name: string): string | null {
    const values = this._map.get(normalizeName(name));
    if (!values || values.length === 0) return null;
    return values.join(', ');
  }

  getSetCookie(): string[] {
    return this._map.get('set-cookie') ?? [];
  }

  has(name: string): boolean {
    return this._map.has(normalizeName(name));
  }

  set(name: string, value: string): void {
    this._map.set(normalizeName(name), [value]);
  }

  forEach(
    callback: (value: string, key: string, headers: NitroHeaders) => void,
    thisArg?: any
  ): void {
    const sortedKeys = Array.from(this._map.keys()).sort();
    for (const key of sortedKeys) {
      callback.call(thisArg, this._map.get(key)!.join(', '), key, this);
    }
  }

  *entries(): IterableIterator<[string, string]> {
    const sortedKeys = Array.from(this._map.keys()).sort();
    for (const key of sortedKeys) {
      yield [key, this._map.get(key)!.join(', ')];
    }
  }

  *keys(): IterableIterator<string> {
    const sortedKeys = Array.from(this._map.keys()).sort();
    for (const key of sortedKeys) {
      yield key;
    }
  }

  *values(): IterableIterator<string> {
    const sortedKeys = Array.from(this._map.keys()).sort();
    for (const key of sortedKeys) {
      yield this._map.get(key)!.join(', ');
    }
  }

  [Symbol.iterator](): IterableIterator<[string, string]> {
    return this.entries();
  }
}
