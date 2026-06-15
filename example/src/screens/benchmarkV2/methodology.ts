import { fetch as nitroFetch, prefetch } from 'react-native-nitro-fetch';

declare const global: any;
declare const requestAnimationFrame: (cb: () => void) => number;
declare const cancelAnimationFrame: (handle: number) => void;

export function now(): number {
  return global.performance ? global.performance.now() : Date.now();
}

export async function waitForIdle(frames = 2): Promise<void> {
  for (let i = 0; i < frames; i++) {
    await new Promise<void>((r) => requestAnimationFrame(() => r()));
  }
  await new Promise<void>((r) => setTimeout(r, 0));
}

export function bust(url: string, n: number): string {
  return url + (url.includes('?') ? '&' : '?') + '_nfb=' + n;
}

export function detectCached(headers: Headers): boolean {
  const get = (k: string) => headers.get(k);
  const age = get('age');
  if (age && Number(age) > 0) return true;
  const combined = (
    (get('x-cache') || '') +
    ' ' +
    (get('x-cache-status') || '') +
    ' ' +
    (get('cf-cache-status') || '') +
    ' ' +
    (get('via') || '')
  ).toUpperCase();
  if (combined.includes('HIT') || combined.includes('REVALIDATED')) return true;
  return false;
}

export class StallMonitor {
  private handle = 0;
  private running = false;
  private last = 0;
  private warmup = 0;
  private frameInterval = 16.7;
  maxStallMs = 0;

  start(): void {
    this.maxStallMs = 0;
    this.frameInterval = 16.7;
    this.running = true;
    this.last = now();

    this.warmup = 2;
    const tick = () => {
      if (!this.running) return;
      const t = now();
      const gap = t - this.last;
      this.last = t;

      if (gap > 8 && gap < this.frameInterval) this.frameInterval = gap;
      if (this.warmup > 0) {
        this.warmup--;
      } else {
        const overrun = gap - this.frameInterval;
        if (overrun > this.maxStallMs) this.maxStallMs = overrun;
      }
      this.handle = requestAnimationFrame(tick);
    };
    this.handle = requestAnimationFrame(tick);
  }

  stop(): number {
    this.running = false;
    if (this.handle) cancelAnimationFrame(this.handle);
    this.handle = 0;
    return this.maxStallMs;
  }
}

export class JsLoadGenerator {
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    this.timer = setInterval(() => {
      const end = now() + 35;

      while (now() < end) {}
    }, 45);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export function median(values: number[]): number | null {
  const v = values
    .filter(Number.isFinite)
    .slice()
    .sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

export function trimmedMean(values: number[], trim = 0.1): number | null {
  const v = values
    .filter(Number.isFinite)
    .slice()
    .sort((a, b) => a - b);
  if (v.length === 0) return null;
  const k = Math.floor(v.length * trim);
  const sliced = v.slice(k, v.length - k);
  const use = sliced.length ? sliced : v;
  return use.reduce((s, x) => s + x, 0) / use.length;
}

export function minOf(values: number[]): number | null {
  const v = values.filter(Number.isFinite);
  return v.length ? Math.min(...v) : null;
}

export function mean(values: number[]): number | null {
  const v = values.filter(Number.isFinite);
  return v.length ? v.reduce((s, x) => s + x, 0) / v.length : null;
}

export function pctFaster(
  builtin: number | null,
  nitro: number | null
): number | null {
  if (builtin == null || nitro == null || builtin <= 0) return null;
  return ((builtin - nitro) / builtin) * 100;
}

// Below a frame, samples are noise; above it, a real React stall contaminated the timing.
export const STALL_THRESHOLD_MS = 12;
export const HEAD_TO_HEAD_ITERATIONS = 4;
export const PREFETCH_ITERATIONS = 4;
export const PREFETCH_TTL_MS = 120_000;

export const REPEAT_RUNS = 10;
// Even so each engine goes first an equal number of times — no first-mover bias.
export const REPEAT_ITERATIONS = 4;

export type FetchFn = (url: string) => Promise<Response>;

export type Sample = {
  ms: number;
  stallMs: number;
  ok: boolean;
  cached: boolean;
  prefetched: boolean;
  error?: string;
};

export async function measureOne(fn: FetchFn, url: string): Promise<Sample> {
  await waitForIdle();
  const monitor = new StallMonitor();
  monitor.start();
  const t0 = now();
  let ok = true;
  let cached = false;
  let prefetched = false;
  let error: string | undefined;
  try {
    const res = await fn(url);
    prefetched = res.headers.get('nitroPrefetched') === 'true';
    cached = detectCached(res.headers);
    await res.arrayBuffer();
  } catch (e: any) {
    ok = false;
    error = e?.message ?? String(e);
  }
  const t1 = now();
  const stallMs = monitor.stop();
  return { ms: t1 - t0, stallMs, ok, cached, prefetched, error };
}

export type EngineStat = {
  median: number | null;
  trimmed: number | null;
  min: number | null;
  clean: number;
  discarded: number;
  errors: number;
};

export function summarize(samples: Sample[]): EngineStat {
  const ok = samples.filter((s) => s.ok);
  const errors = samples.length - ok.length;
  const clean = ok.filter((s) => s.stallMs <= STALL_THRESHOLD_MS);
  const discarded = ok.length - clean.length;
  const ms = clean.map((s) => s.ms);
  return {
    median: median(ms),
    trimmed: trimmedMean(ms),
    min: minOf(ms),
    clean: clean.length,
    discarded,
    errors,
  };
}

// Median over every successful sample, contaminated ones included.
export function summarizeNaive(samples: Sample[]): number | null {
  return median(samples.filter((s) => s.ok).map((s) => s.ms));
}

export type EndpointResult = {
  label: string;
  cat: string;
  builtin: EngineStat;
  nitro: EngineStat;
  builtinNaive: number | null;
  nitroNaive: number | null;
};

export type PrefetchResult = {
  label: string;
  builtinCold: EngineStat;
  nitroCold: EngineStat;
  nitroPrefetched: EngineStat;
  hits: number;
  misses: number;
};

export type Endpoint = { url: string; label: string; cat: string };

export const ENDPOINTS: Endpoint[] = [
  {
    url: 'https://api.ipify.org?format=json',
    label: 'ipify.org',
    cat: 'Tiny JSON',
  },
  {
    url: 'https://www.cloudflare.com/cdn-cgi/trace',
    label: 'cloudflare trace',
    cat: 'Tiny',
  },
  {
    url: 'https://catfact.ninja/fact',
    label: 'catfact.ninja',
    cat: 'Tiny JSON',
  },
  {
    url: 'https://api.chucknorris.io/jokes/random',
    label: 'chucknorris.io',
    cat: 'Tiny JSON',
  },
  {
    url: 'https://official-joke-api.appspot.com/random_joke',
    label: 'official-joke-api',
    cat: 'Tiny JSON',
  },
  {
    url: 'https://dog.ceo/api/breeds/image/random',
    label: 'dog.ceo',
    cat: 'Tiny JSON',
  },
  {
    url: 'https://jsonplaceholder.typicode.com/todos/1',
    label: 'jsonplaceholder todo',
    cat: 'Small JSON',
  },
  {
    url: 'https://hacker-news.firebaseio.com/v0/item/8863.json',
    label: 'hacker-news item',
    cat: 'Small JSON',
  },
  {
    url: 'https://pokeapi.co/api/v2/pokemon/ditto',
    label: 'pokeapi ditto',
    cat: 'Medium JSON',
  },
  {
    url: 'https://restcountries.com/v3.1/alpha/us',
    label: 'restcountries us',
    cat: 'Medium JSON',
  },
  {
    url: 'https://api.github.com/repos/facebook/react',
    label: 'github repo',
    cat: 'Medium JSON',
  },
  {
    url: 'https://jsonplaceholder.typicode.com/posts',
    label: 'jsonplaceholder posts',
    cat: 'Large JSON',
  },
  {
    url: 'https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js',
    label: 'jsdelivr axios.min.js',
    cat: 'CDN asset',
  },
  {
    url: 'https://unpkg.com/react@18/umd/react.production.min.js',
    label: 'unpkg react',
    cat: 'CDN asset',
  },
  {
    url: 'https://raw.githubusercontent.com/github/gitignore/main/Node.gitignore',
    label: 'raw.githubusercontent',
    cat: 'CDN text',
  },
];

export const REPEAT_ENDPOINTS: Endpoint[] = ENDPOINTS.filter(
  (e) => !e.url.includes('api.github.com')
);

export const PREFETCH_ENDPOINTS: Endpoint[] = [
  {
    url: 'https://jsonplaceholder.typicode.com/todos/1',
    label: 'jsonplaceholder todo',
    cat: 'Small JSON',
  },
  {
    url: 'https://api.github.com/repos/facebook/react',
    label: 'github repo',
    cat: 'Medium JSON',
  },
  {
    url: 'https://pokeapi.co/api/v2/pokemon/ditto',
    label: 'pokeapi ditto',
    cat: 'Medium JSON',
  },
  {
    url: 'https://restcountries.com/v3.1/alpha/us',
    label: 'restcountries us',
    cat: 'Medium JSON',
  },
  {
    url: 'https://catfact.ninja/fact',
    label: 'catfact.ninja',
    cat: 'Tiny JSON',
  },
];

let bustCounter = 1;
export function nextBust(): number {
  return bustCounter++;
}

export type HeadToHeadOptions = {
  iterations?: number;
  endpoints?: Endpoint[];
};

export async function runHeadToHead(
  onProgress: (label: string, done: number, total: number) => Promise<void>,
  opts: HeadToHeadOptions = {}
): Promise<EndpointResult[]> {
  const iterations = opts.iterations ?? HEAD_TO_HEAD_ITERATIONS;
  const endpoints = opts.endpoints ?? ENDPOINTS;
  const builtinFetch: FetchFn = (u) => global.fetch(u);
  const nitro: FetchFn = (u) => nitroFetch(u);
  const results: EndpointResult[] = [];
  const total = endpoints.length;

  for (let i = 0; i < endpoints.length; i++) {
    const ep = endpoints[i];
    await onProgress(ep.label, i, total);

    // Warm each engine's own pool independently so one failure can't leave the other cold.
    try {
      await builtinFetch(bust(ep.url, nextBust())).then((r) => r.arrayBuffer());
    } catch {}
    try {
      await nitro(bust(ep.url, nextBust())).then((r) => r.arrayBuffer());
    } catch {}

    const builtinSamples: Sample[] = [];
    const nitroSamples: Sample[] = [];
    for (let it = 0; it < iterations; it++) {
      const builtinFirst = it % 2 === 0;
      if (builtinFirst) {
        builtinSamples.push(
          await measureOne(builtinFetch, bust(ep.url, nextBust()))
        );
        nitroSamples.push(await measureOne(nitro, bust(ep.url, nextBust())));
      } else {
        nitroSamples.push(await measureOne(nitro, bust(ep.url, nextBust())));
        builtinSamples.push(
          await measureOne(builtinFetch, bust(ep.url, nextBust()))
        );
      }
    }

    results.push({
      label: ep.label,
      cat: ep.cat,
      builtin: summarize(builtinSamples),
      nitro: summarize(nitroSamples),
      builtinNaive: summarizeNaive(builtinSamples),
      nitroNaive: summarizeNaive(nitroSamples),
    });
  }

  await onProgress('done', total, total);
  return results;
}

export type H2HRun = {
  run: number;
  builtinMedian: number | null;
  nitroMedian: number | null;
  nitroNaive: number | null;
  speedup: number | null;
  pct: number | null;
  nitroWins: number;
  counted: number;
  discarded: number;
  errors: number;
};

export type H2HSummary = {
  runs: number;
  builtinMedian: number | null;
  nitroMedian: number | null;
  builtinAvg: number | null;
  nitroAvg: number | null;
  medianSpeedup: number | null;
  medianPct: number | null;
  avgSpeedup: number | null;
  avgPct: number | null;
  totalDiscarded: number;
  totalErrors: number;
};

export function summarizeRuns(table: H2HRun[]): H2HSummary {
  const bMeds = table
    .map((r) => r.builtinMedian)
    .filter((x): x is number => x != null);
  const nMeds = table
    .map((r) => r.nitroMedian)
    .filter((x): x is number => x != null);
  const builtinMedian = median(bMeds);
  const nitroMedian = median(nMeds);
  const builtinAvg = mean(bMeds);
  const nitroAvg = mean(nMeds);
  return {
    runs: table.length,
    builtinMedian,
    nitroMedian,
    builtinAvg,
    nitroAvg,
    medianSpeedup:
      builtinMedian != null && nitroMedian != null && nitroMedian > 0
        ? builtinMedian / nitroMedian
        : null,
    medianPct: pctFaster(builtinMedian, nitroMedian),
    avgSpeedup:
      builtinAvg != null && nitroAvg != null && nitroAvg > 0
        ? builtinAvg / nitroAvg
        : null,
    avgPct: pctFaster(builtinAvg, nitroAvg),
    totalDiscarded: table.reduce((s, r) => s + r.discarded, 0),
    totalErrors: table.reduce((s, r) => s + r.errors, 0),
  };
}

function aggregateRun(run: number, rows: EndpointResult[]): H2HRun {
  const builtinMedian = median(
    rows.map((r) => r.builtin.median).filter((x): x is number => x != null)
  );
  const nitroMedian = median(
    rows.map((r) => r.nitro.median).filter((x): x is number => x != null)
  );
  const nitroNaive = median(
    rows.map((r) => r.nitroNaive).filter((x): x is number => x != null)
  );
  const counted = rows.filter(
    (r) => r.nitro.median != null && r.builtin.median != null
  ).length;
  const nitroWins = rows.filter(
    (r) =>
      r.nitro.median != null &&
      r.builtin.median != null &&
      r.nitro.median < r.builtin.median
  ).length;
  return {
    run,
    builtinMedian,
    nitroMedian,
    nitroNaive,
    speedup:
      builtinMedian != null && nitroMedian != null && nitroMedian > 0
        ? builtinMedian / nitroMedian
        : null,
    pct: pctFaster(builtinMedian, nitroMedian),
    nitroWins,
    counted,
    discarded: rows.reduce(
      (s, r) => s + r.builtin.discarded + r.nitro.discarded,
      0
    ),
    errors: rows.reduce((s, r) => s + r.builtin.errors + r.nitro.errors, 0),
  };
}

export async function runHeadToHeadRepeated(
  runs: number,
  onProgress: (
    run: number,
    totalRuns: number,
    label: string,
    done: number,
    total: number
  ) => Promise<void>
): Promise<H2HRun[]> {
  const table: H2HRun[] = [];
  for (let r = 0; r < runs; r++) {
    const rows = await runHeadToHead(
      (label, done, total) => onProgress(r, runs, label, done, total),
      { iterations: REPEAT_ITERATIONS, endpoints: REPEAT_ENDPOINTS }
    );
    const summary = aggregateRun(r + 1, rows);
    table.push(summary);
    console.log('[BenchV2] run', JSON.stringify(summary));
  }
  console.log('[BenchV2] table', JSON.stringify(table));
  console.log('[BenchV2] summary', JSON.stringify(summarizeRuns(table)));
  return table;
}

export async function runPrefetch(
  onProgress: (label: string, done: number, total: number) => Promise<void>
): Promise<PrefetchResult[]> {
  const builtinFetch: FetchFn = (u) => global.fetch(u);
  const nitro: FetchFn = (u) => nitroFetch(u);
  const results: PrefetchResult[] = [];
  const total = PREFETCH_ENDPOINTS.length;

  for (let i = 0; i < PREFETCH_ENDPOINTS.length; i++) {
    const ep = PREFETCH_ENDPOINTS[i];
    await onProgress(ep.label, i, total);

    // Warm each engine's own pool independently so neither cold baseline pays DNS/TLS alone.
    try {
      await builtinFetch(bust(ep.url, nextBust())).then((r) => r.arrayBuffer());
    } catch {}
    try {
      await nitro(bust(ep.url, nextBust())).then((r) => r.arrayBuffer());
    } catch {}

    const coldBuiltin: Sample[] = [];
    const coldNitro: Sample[] = [];
    const prefetched: Sample[] = [];
    let hits = 0;
    let misses = 0;

    for (let it = 0; it < PREFETCH_ITERATIONS; it++) {
      if (it % 2 === 0) {
        coldBuiltin.push(
          await measureOne(builtinFetch, bust(ep.url, nextBust()))
        );
        coldNitro.push(await measureOne(nitro, bust(ep.url, nextBust())));
      } else {
        coldNitro.push(await measureOne(nitro, bust(ep.url, nextBust())));
        coldBuiltin.push(
          await measureOne(builtinFetch, bust(ep.url, nextBust()))
        );
      }

      const key = `bench-v2-${ep.label}-${it}`;
      try {
        // Await the dispatch: native has the bytes cached before we consume.
        await prefetch(ep.url, {
          headers: { prefetchKey: key },
          prefetchCacheTtlMs: PREFETCH_TTL_MS,
        } as any);
      } catch {}

      const sample = await measureOne(
        (u) =>
          nitroFetch(u, {
            headers: { prefetchKey: key },
            prefetchCacheTtlMs: PREFETCH_TTL_MS,
          } as any),
        ep.url
      );
      if (sample.ok && sample.prefetched) {
        hits++;
        prefetched.push(sample);
      } else if (sample.ok) {
        misses++;
      }
    }

    results.push({
      label: ep.label,
      builtinCold: summarize(coldBuiltin),
      nitroCold: summarize(coldNitro),
      nitroPrefetched: summarize(prefetched),
      hits,
      misses,
    });
  }

  await onProgress('done', total, total);
  return results;
}
