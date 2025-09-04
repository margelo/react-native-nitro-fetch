import React from 'react';
import { Text, View, StyleSheet, Button, ScrollView, Modal, Pressable } from 'react-native';
import { fetch as nitroFetch, nitroFetchOnWorklet } from 'react-native-nitro-fetch';
import 'react-native-nitro-fetch/src/fetch';

type Row = {
  url: string;
  builtinMs: number;
  nitroMs: number;
  errorBuiltin?: string;
  errorNitro?: string;
  cacheableBuiltin?: boolean;
  cacheableNitro?: boolean;
};

const CANDIDATES: string[] = [
  // Small HTML/text
  'https://example.com',
  'https://example.org',
  'https://www.google.com/robots.txt',
  'https://www.wikipedia.org',
  'https://news.ycombinator.com',
  'https://developer.mozilla.org',
  'https://www.cloudflare.com/cdn-cgi/trace',
  'https://www.apple.com',
  'https://www.microsoft.com',
  'https://www.reddit.com/.json',
  // httpbin
  'https://httpbin.org/get',
  'https://httpbin.org/uuid',
  'https://httpbin.org/ip',
  'https://httpbin.org/headers',
  // jsonplaceholder
  'https://jsonplaceholder.typicode.com/todos/1',
  'https://jsonplaceholder.typicode.com/todos/2',
  'https://jsonplaceholder.typicode.com/todos/3',
  'https://jsonplaceholder.typicode.com/posts/1',
  'https://jsonplaceholder.typicode.com/posts/2',
  'https://jsonplaceholder.typicode.com/posts/3',
  'https://jsonplaceholder.typicode.com/users/1',
  'https://jsonplaceholder.typicode.com/users/2',
  'https://jsonplaceholder.typicode.com/users/3',
  // status pages (small bodies)
  'https://httpstat.us/200',
  'https://httpstat.us/204',
  'https://httpstat.us/301',
  'https://httpstat.us/302',
  'https://httpstat.us/404',
  'https://httpstat.us/418',
  'https://httpstat.us/500',
  'https://httpstat.us/503',
  // raw small files
  'https://raw.githubusercontent.com/github/gitignore/main/Node.gitignore',
  'https://raw.githubusercontent.com/github/gitignore/main/Android.gitignore',
  'https://raw.githubusercontent.com/github/gitignore/main/Swift.gitignore',
  'https://raw.githubusercontent.com/github/gitignore/main/Go.gitignore',
  'https://raw.githubusercontent.com/github/gitignore/main/Python.gitignore',
  'https://raw.githubusercontent.com/github/gitignore/main/Ruby.gitignore',
  // CDN JS (moderate size)
  'https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js',
  'https://cdn.jsdelivr.net/npm/lodash-es/lodash.js',
  'https://unpkg.com/react/umd/react.production.min.js',
  'https://unpkg.com/react-dom/umd/react-dom.production.min.js',
  // IP/info
  'https://icanhazip.com',
  'https://ipapi.co/json/',
  'https://wttr.in/?format=3',
  // robots from various sites
  'https://github.com/robots.txt',
  'https://www.youtube.com/robots.txt',
  'https://www.npmjs.com/robots.txt',
  'https://www.cloudflare.com/robots.txt',
  'https://www.netflix.com/robots.txt',
  'https://www.bbc.co.uk/robots.txt',
  'https://www.nytimes.com/robots.txt',
  'https://www.stackoverflow.com/robots.txt',
  'https://www.stackexchange.com/robots.txt',
  'https://www.cloudflarestatus.com/robots.txt',
  // misc
  'https://api.github.com',
  'https://api.ipify.org?format=json',
  'https://httpbingo.org/get',
  'https://httpbingo.org/headers',
  'https://httpbingo.org/uuid',
  'https://ifconfig.co/json',
  'https://get.geojs.io/v1/ip.json',
  'https://get.geojs.io/v1/ip/geo.json',
];

function pickRandomUrls(n: number): string[] {
  // Choose without replacement to avoid duplicates
  const arr = [...CANDIDATES];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, Math.min(n, arr.length));
}

function trimmedAverage(values: number[], trimFraction = 0.1): number | null {
  const valid = values.filter((v) => Number.isFinite(v));
  if (valid.length === 0) return null;
  const sorted = valid.slice().sort((a, b) => a - b);
  const k = Math.floor(sorted.length * trimFraction);
  const start = Math.min(k, sorted.length);
  const end = Math.max(start, sorted.length - k);
  const sliced = sorted.slice(start, end);
  if (sliced.length === 0) return null;
  const sum = sliced.reduce((s, v) => s + v, 0);
  return sum / sliced.length;
}

function detectCacheable(headers: Headers, minSeconds = 60): boolean {
  const cc = headers.get('cache-control')?.toLowerCase() ?? '';
  if (cc.includes('no-store') || cc.includes('no-cache')) return false;
  // s-maxage takes precedence for shared caches, but we treat either as cacheable
  const maxAgeMatch = cc.match(/max-age=(\d+)/);
  const sMaxAgeMatch = cc.match(/s-maxage=(\d+)/);
  const maxAge = maxAgeMatch ? parseInt(maxAgeMatch[1], 10) : undefined;
  const sMaxAge = sMaxAgeMatch ? parseInt(sMaxAgeMatch[1], 10) : undefined;
  if ((maxAge !== undefined && maxAge > minSeconds) || (sMaxAge !== undefined && sMaxAge > minSeconds)) return true;
  const expires = headers.get('expires');
  if (expires) {
    const t = Date.parse(expires);
    if (!Number.isNaN(t)) {
      const diffSec = (t - Date.now()) / 1000;
      if (diffSec > minSeconds) return true;
    }
  }
  return false;
}

async function measure(fn: (url: string) => Promise<Response>, url: string): Promise<{ ms: number } & ({ ok: true; cacheable: boolean } | { ok: false; error: string })> {
  const t0 = global.performance ? global.performance.now() : Date.now();
  try {
    const res = await fn(`${url}?timestamp=${performance.now()}`);
    // Ensure body read to make timing comparable
    await res.arrayBuffer();
    const t1 = global.performance ? global.performance.now() : Date.now();
    const cacheable = detectCacheable(res.headers);
    return { ok: true, ms: t1 - t0, cacheable } as const;
  } catch (e: any) {
    const t1 = global.performance ? global.performance.now() : Date.now();
    return { ok: false, ms: t1 - t0, error: e?.message ?? String(e) } as const;
  }
}

export default function App() {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [avgBuiltinAll, setAvgBuiltinAll] = React.useState<number | null>(null);
  const [avgNitroAll, setAvgNitroAll] = React.useState<number | null>(null);
  const [avgBuiltinNC, setAvgBuiltinNC] = React.useState<number | null>(null);
  const [avgNitroNC, setAvgNitroNC] = React.useState<number | null>(null);
  const [running, setRunning] = React.useState(false);
  const [showSheet, setShowSheet] = React.useState(false);
  const [prices, setPrices] = React.useState<Array<{ id: string; usd: number }>>([]);

  const loadPrices = React.useCallback(async () => {
    console.log('Loading crypto prices from coingecko start');
    const ids = [
      'bitcoin','ethereum','solana','dogecoin','litecoin','cardano','ripple','polkadot','chainlink','polygon-pos'
    ];
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids.join(','))}&vs_currencies=usd`;
    const mapper = (payload: { bodyString?: string }) => {
      'worklet';
      const txt = payload.bodyString ?? '';
      const json = JSON.parse(txt) as Record<string, { usd: number }>;
      const arr = Object.entries(json).map(([id, v]) => ({ id, usd: v.usd }));
      arr.sort((a, b) => a.id.localeCompare(b.id));
      return arr;
    };
    console.log('Loading crypto prices from coingecko');
    const data = await nitroFetchOnWorklet(url, undefined, mapper, { preferBytes: false });
    console.log('Loaded crypto prices:', data);
    setPrices(data);
  }, []);

  const run = React.useCallback(async () => {
    if (running) return;
    setRunning(true);
    try {
      const urls = pickRandomUrls(50);
      const out = await Promise.all(
        urls.map(async (url): Promise<Row> => {
          const [b, n] = await Promise.all([measure(global.fetch, url), measure(nitroFetch, url)]);
          return {
            url,
            builtinMs: b.ms,
            nitroMs: n.ms,
            errorBuiltin: b.ok ? undefined : b.error,
            errorNitro: n.ok ? undefined : n.error,
            cacheableBuiltin: b.ok ? b.cacheable : undefined,
            cacheableNitro: n.ok ? n.cacheable : undefined,
          };
        })
      );
      setRows(out);
      const okRows = out.filter((r) => r.errorBuiltin == null && r.errorNitro == null);
      const avgBAll = trimmedAverage(okRows.map((r) => r.builtinMs));
      const avgNAll = trimmedAverage(okRows.map((r) => r.nitroMs));
      const avgBNC = trimmedAverage(okRows.filter(r => r.cacheableBuiltin === false).map((r) => r.builtinMs));
      const avgNNC = trimmedAverage(okRows.filter(r => r.cacheableNitro === false).map((r) => r.nitroMs));
      setAvgBuiltinAll(avgBAll);
      setAvgNitroAll(avgNAll);
      setAvgBuiltinNC(avgBNC);
      setAvgNitroNC(avgNNC);
      console.log('trimmed avgs (all, not-cached)', avgBAll, avgNAll, avgBNC, avgNNC);
    } finally {
      setRunning(false);
    }
  }, [running]);

  React.useEffect(() => {
    run();
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Nitro vs Built-in Fetch</Text>
      <View style={styles.actions}>
        <Button title={running ? 'Running…' : 'Run Again'} onPress={run} disabled={running} />
        <View style={{ width: 12 }} />
        <Button title="Show Crypto Prices" onPress={() => { setShowSheet(true); loadPrices(); }} />
      </View>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {rows == null ? (
          <Text>Measuring…</Text>
        ) : (
          <>
            <View style={styles.headerRow}>
              <Text style={[styles.cell, styles.url]}>URL</Text>
              <Text style={styles.cell}>Built-in (ms)</Text>
              <Text style={styles.cell}>Nitro (ms)</Text>
              <Text style={styles.cell}>Cacheable B/N</Text>
            </View>
            {rows.map((r) => {
              const builtinWins = r.builtinMs < r.nitroMs;
              const nitroWins = r.nitroMs < r.builtinMs;
              return (
                <View key={r.url} style={styles.row}>
                  <Text style={[styles.cell, styles.url]} numberOfLines={1}>
                    {r.url}
                  </Text>
                  <Text style={[styles.cell, builtinWins ? styles.winner : undefined]}>
                    {r.errorBuiltin ? 'Err' : Number.isFinite(r.builtinMs) ? r.builtinMs.toFixed(1) : '—'}
                  </Text>
                  <Text style={[styles.cell, nitroWins ? styles.winner : undefined]}>
                    {r.errorNitro ? 'Err' : Number.isFinite(r.nitroMs) ? r.nitroMs.toFixed(1) : '—'}
                  </Text>
                  <Text style={styles.cell}>
                    {r.cacheableBuiltin == null ? '?' : r.cacheableBuiltin ? 'B✓' : 'B✗'}{' '}
                    {r.cacheableNitro == null ? '?' : r.cacheableNitro ? 'N✓' : 'N✗'}
                  </Text>
                </View>
              );
            })}
            <View style={styles.footer}>
              <Text style={styles.avg}>
                Built-in avg (all / not cached): {avgBuiltinAll != null ? avgBuiltinAll.toFixed(1) : '—'} ms / {avgBuiltinNC != null ? avgBuiltinNC.toFixed(1) : '—'} ms
              </Text>
              <Text style={styles.avg}>
                Nitro avg (all / not cached): {avgNitroAll != null ? avgNitroAll.toFixed(1) : '—'} ms / {avgNitroNC != null ? avgNitroNC.toFixed(1) : '—'} ms
              </Text>
            </View>
          </>
        )}
      </ScrollView>
      <Modal
        visible={showSheet}
        transparent
        animationType="slide"
        onRequestClose={() => setShowSheet(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setShowSheet(false)}>
          <View />
        </Pressable>
        <View style={styles.sheet}>
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle}>Crypto Prices (USD)</Text>
            <Button title="Close" onPress={() => setShowSheet(false)} />
          </View>
          <ScrollView style={{ maxHeight: 360 }}>
            {prices.length === 0 ? (
              <Text style={{ padding: 12 }}>Loading…</Text>
            ) : (
              prices.map((p) => (
                <View key={p.id} style={styles.priceRow}>
                  <Text style={styles.priceId}>{p.id}</Text>
                  <Text style={styles.priceVal}>${p.usd.toLocaleString(undefined, { maximumFractionDigits: 6 })}</Text>
                </View>
              ))
            )}
          </ScrollView>
        </View>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingTop: 48,

  },
  title: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 8,
  },
  actions: {
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    marginBottom: 8,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)'
  },
  sheet: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 12,
    borderTopRightRadius: 12,
    paddingBottom: 24,
  },
  sheetHeader: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#eee',
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '600',
  },
  priceRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#f1f1f1',
  },
  priceId: {
    fontSize: 14,
  },
  priceVal: {
    fontSize: 14,
    fontVariant: ['tabular-nums'],
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 12,
    paddingBottom: 24,
  },
  headerRow: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#ccc',
    paddingVertical: 6,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#eee',
  },
  cell: {
    width: 100,
    fontVariant: ['tabular-nums'],
  },
  winner: {
    color: 'green',
    fontWeight: '600',
  },
  url: {
    flex: 1,
    width: undefined,
    marginRight: 8,
  },
  footer: {
    marginTop: 12,
  },
  avg: {
    textAlign: 'center',
    fontSize: 16,
  },
  error: {
    color: 'red',
    marginLeft: 8,
  },
});
