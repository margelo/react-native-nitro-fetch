import React from 'react';
import { Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { fetch as nitroFetch } from 'react-native-nitro-fetch';
import { fetchStreamedData } from './stream';

type Row = {
  url: string;
  builtinMs: number;
  nitroMs: number;
  errorBuiltin?: string;
  errorNitro?: string;
  cachedBuiltin?: boolean;
  cachedNitro?: boolean;
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

function detectCached(headers: Headers): boolean {
  const get = (k: string) => headers.get(k);
  const age = get('age');
  if (age && Number(age) > 0) return true;
  const hits = get('x-cache-hits');
  if (hits && Number(hits) > 0) return true;
  const combined = (
    (get('x-cache') || '') +
    ' ' +
    (get('x-cache-status') || '') +
    ' ' +
    (get('x-cache-remote') || '') +
    ' ' +
    (get('cf-cache-status') || '') +
    ' ' +
    (get('via') || '')
  ).toUpperCase();
  if (combined.includes('HIT') || combined.includes('REVALIDATED')) return true;
  if (combined.includes('MISS')) return false;
  return false;
}

async function measure(
  fn: (url: string) => Promise<Response>,
  url: string
): Promise<
  { ms: number } & (
    | { ok: true; cached: boolean }
    | { ok: false; error: string }
  )
> {
  const t0 = global.performance ? global.performance.now() : Date.now();
  try {
    const res = await fn(`${url}?timestamp=${performance.now()}`);
    // Ensure body read to make timing comparable
    await res.arrayBuffer();
    const t1 = global.performance ? global.performance.now() : Date.now();
    const cached = detectCached(res.headers);
    return { ok: true, ms: t1 - t0, cached } as const;
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
  const [result, setResult] = React.useState<string>('');

  const runCandidatesTest = React.useCallback(async () => {
    if (running) return;
    setRunning(true);
    try {
      const urls = pickRandomUrls(50);
      const out = await Promise.all(
        urls.map(async (url): Promise<Row> => {
          const [b, n] = await Promise.all([
            measure(global.fetch, url),
            measure(nitroFetch, url),
          ]);
          return {
            url,
            builtinMs: b.ms,
            nitroMs: n.ms,
            errorBuiltin: b.ok ? undefined : b.error,
            errorNitro: n.ok ? undefined : n.error,
            cachedBuiltin: b.ok ? b.cached : undefined,
            cachedNitro: n.ok ? n.cached : undefined,
          };
        })
      );
      setRows(out);
      const okRows = out.filter(
        (r) => r.errorBuiltin == null && r.errorNitro == null
      );
      const avgBAll = trimmedAverage(okRows.map((r) => r.builtinMs));
      const avgNAll = trimmedAverage(okRows.map((r) => r.nitroMs));
      const avgBNC = trimmedAverage(
        okRows.filter((r) => r.cachedBuiltin === false).map((r) => r.builtinMs)
      );
      const avgNNC = trimmedAverage(
        okRows.filter((r) => r.cachedNitro === false).map((r) => r.nitroMs)
      );
      setAvgBuiltinAll(avgBAll);
      setAvgNitroAll(avgNAll);
      setAvgBuiltinNC(avgBNC);
      setAvgNitroNC(avgNNC);
      console.log(
        'trimmed avgs (all, not-cached)',
        avgBAll,
        avgNAll,
        avgBNC,
        avgNNC
      );
    } finally {
      setRunning(false);
    }
  }, [running]);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Nitro vs Built-in Fetch</Text>
      <View style={styles.actions}>
        <Button
          title={running ? 'Running…' : 'Run CANDIDATES Test'}
          onPress={runCandidatesTest}
          disabled={running}
        />
        <Button
          title={'test fetch'}
          onPress={async () => {
            try {
              const res = await nitroFetch(
                'https://jsonplaceholder.typicode.com/posts/3'
              );
              const json = await res.json();
              console.log('JSON:', json);
            } catch (err) {
              console.log('Error:', err);
            }
          }}
          disabled={running}
        />
        <Button
          title="Run Stream Test"
          onPress={async () => {
            // await fetchStreamedData({
            //   onData: (data) => {
            //     console.log('Received:', data);
            //   },
            //   onStreamComplete: () => console.log('Done!'),
            // });
            // const end = performance.now();
            // console.log(`Streaming took ${end - start}ms`);
            // setElapsedTime(end - start);
            const totalStart = performance.now();
            const times: number[] = [];

            for (let i = 0; i < 30; i++) {
              const start = performance.now();
              await fetchStreamedData();
              const end = performance.now();
              const duration = end - start;
              times.push(duration);
              console.log(
                `Stream test ${i + 1}/100 took ${duration.toFixed(2)}ms`
              );
            }

            const totalEnd = performance.now();
            const totalDuration = totalEnd - totalStart;
            const avgDuration = times.reduce((a, b) => a + b, 0) / times.length;
            const minDuration = Math.min(...times);
            const maxDuration = Math.max(...times);

            console.log('='.repeat(50));
            console.log(
              `Completed 100 stream tests in ${totalDuration.toFixed(2)}ms`
            );
            console.log(`Average: ${avgDuration.toFixed(2)}ms`);
            console.log(`Min: ${minDuration.toFixed(2)}ms`);
            console.log(`Max: ${maxDuration.toFixed(2)}ms`);
            console.log('='.repeat(50));
            setResult(
              [
                `Average: ${avgDuration.toFixed(2)}ms`,
                `Min: ${minDuration.toFixed(2)}ms`,
                `Max: ${maxDuration.toFixed(2)}ms`,
              ].join('\n')
            );
          }}
          disabled={running}
        />
      </View>
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {rows == null ? (
          <Text style={styles.placeholder}>{result}</Text>
        ) : (
          <>
            <View style={styles.headerRow}>
              <Text style={[styles.cell, styles.url]}>URL</Text>
              <Text style={styles.cell}>Built-in (ms)</Text>
              <Text style={styles.cell}>Nitro (ms)</Text>
              <Text style={styles.cell}>Cache B/N</Text>
            </View>
            {rows.map((r) => {
              const builtinWins = r.builtinMs < r.nitroMs;
              const nitroWins = r.nitroMs < r.builtinMs;
              return (
                <View key={r.url} style={styles.row}>
                  <Text style={[styles.cell, styles.url]} numberOfLines={1}>
                    {r.url}
                  </Text>
                  <Text
                    style={[
                      styles.cell,
                      builtinWins ? styles.winner : undefined,
                    ]}
                  >
                    {r.errorBuiltin
                      ? 'Err'
                      : Number.isFinite(r.builtinMs)
                        ? r.builtinMs.toFixed(1)
                        : '—'}
                  </Text>
                  <Text
                    style={[styles.cell, nitroWins ? styles.winner : undefined]}
                  >
                    {r.errorNitro
                      ? 'Err'
                      : Number.isFinite(r.nitroMs)
                        ? r.nitroMs.toFixed(1)
                        : '—'}
                  </Text>
                  <Text style={styles.cell}>
                    {r.cachedBuiltin == null
                      ? '?'
                      : r.cachedBuiltin
                        ? 'B✓'
                        : 'B✗'}{' '}
                    {r.cachedNitro == null ? '?' : r.cachedNitro ? 'N✓' : 'N✗'}
                  </Text>
                </View>
              );
            })}
            <View style={styles.footer}>
              <Text style={styles.avg}>
                Built-in avg (all / not cached):{' '}
                {avgBuiltinAll != null ? avgBuiltinAll.toFixed(1) : '—'} ms /{' '}
                {avgBuiltinNC != null ? avgBuiltinNC.toFixed(1) : '—'} ms
              </Text>
              <Text style={styles.avg}>
                Nitro avg (all / not cached):{' '}
                {avgNitroAll != null ? avgNitroAll.toFixed(1) : '—'} ms /{' '}
                {avgNitroNC != null ? avgNitroNC.toFixed(1) : '—'} ms
              </Text>
            </View>
          </>
        )}
      </ScrollView>
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
    marginBottom: 12,
    gap: 12,
  },
  placeholder: {
    textAlign: 'center',
    marginTop: 24,
    fontSize: 16,
    color: '#666',
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
});
