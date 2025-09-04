import React from 'react';
import { Text, View, StyleSheet, Button, ScrollView } from 'react-native';
import { fetch as nitroFetch } from 'react-native-nitro-fetch';

type Row = {
  url: string;
  builtinMs: number;
  nitroMs: number;
  errorBuiltin?: string;
  errorNitro?: string;
};

const CANDIDATES: string[] = [
  'https://example.com',
  'https://httpbin.org/get',
  'https://jsonplaceholder.typicode.com/todos/1',
  'https://jsonplaceholder.typicode.com/posts/1',
  'https://jsonplaceholder.typicode.com/users/1',
  'https://api.github.com',
  'https://www.wikipedia.org',
  'https://www.google.com/robots.txt',
  'https://cdn.jsdelivr.net/npm/lodash-es/lodash.js',
  'https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js',
  'https://unpkg.com/react/umd/react.production.min.js',
  'https://unpkg.com/react-dom/umd/react-dom.production.min.js',
  'https://www.cloudflare.com/cdn-cgi/trace',
  'https://developer.mozilla.org',
  'https://www.apple.com',
  'https://www.microsoft.com',
  'https://news.ycombinator.com',
  'https://www.reddit.com/.json',
  'https://httpstat.us/200',
  'https://httpstat.us/204',
  'https://httpstat.us/301',
  'https://httpstat.us/302',
  'https://httpstat.us/404',
  'https://httpstat.us/500',
  'https://raw.githubusercontent.com/github/gitignore/main/Node.gitignore',
  'https://raw.githubusercontent.com/github/gitignore/main/Android.gitignore',
  'https://raw.githubusercontent.com/github/gitignore/main/Swift.gitignore',
  'https://icanhazip.com',
  'https://wttr.in/?format=3',
  'https://ipapi.co/json/',
];

function pickRandomUrls(n: number): string[] {
  const arr = [...CANDIDATES];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr.slice(0, n);
}

async function measure(fn: (url: string) => Promise<Response>, url: string): Promise<{ ms: number } & ({ ok: true } | { ok: false; error: string })> {
  const t0 = global.performance ? global.performance.now() : Date.now();
  try {
    const res = await fn(url);
    // Ensure body read to make timing comparable
    await res.arrayBuffer();
    const t1 = global.performance ? global.performance.now() : Date.now();
    return { ok: true, ms: t1 - t0 } as const;
  } catch (e: any) {
    const t1 = global.performance ? global.performance.now() : Date.now();
    return { ok: false, ms: t1 - t0, error: e?.message ?? String(e) } as const;
  }
}

export default function App() {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [avgBuiltin, setAvgBuiltin] = React.useState<number | null>(null);
  const [avgNitro, setAvgNitro] = React.useState<number | null>(null);
  const [running, setRunning] = React.useState(false);

  const run = React.useCallback(async () => {
    if (running) return;
    setRunning(true);
    try {
      const urls = pickRandomUrls(20);
      const out = await Promise.all(
        urls.map(async (url): Promise<Row> => {
          const [b, n] = await Promise.all([measure(global.fetch, url), measure(nitroFetch, url)]);
          return {
            url,
            builtinMs: b.ms,
            nitroMs: n.ms,
            errorBuiltin: b.ok ? undefined : b.error,
            errorNitro: n.ok ? undefined : n.error,
          };
        })
      );
      setRows(out);
      const okRows = out.filter((r) => Number.isFinite(r.builtinMs) && Number.isFinite(r.nitroMs));
      const avgB = okRows.reduce((s, r) => s + r.builtinMs, 0) / Math.max(1, okRows.length);
      const avgN = okRows.reduce((s, r) => s + r.nitroMs, 0) / Math.max(1, okRows.length);
      setAvgBuiltin(avgB);
      setAvgNitro(avgN);
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
                </View>
              );
            })}
            <View style={styles.footer}>
              <Text style={styles.avg}>Avg built-in: {avgBuiltin?.toFixed(1)} ms</Text>
              <Text style={styles.avg}>Avg nitro: {avgNitro?.toFixed(1)} ms</Text>
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
    marginBottom: 8,
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
