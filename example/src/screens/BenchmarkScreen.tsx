import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { fetch as nitroFetch } from 'react-native-nitro-fetch';
import { theme } from '../theme';

type Row = {
  url: string;
  builtinMs: number;
  nitroMs: number;
  errorBuiltin?: string;
  errorNitro?: string;
  cachedBuiltin?: boolean;
  cachedNitro?: boolean;
};

declare const global: any;
declare const performance: any;

// Use the existing candidates list
const CANDIDATES: string[] = [
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
  'https://httpbin.org/get',
  'https://httpbin.org/uuid',
  'https://httpbin.org/ip',
  'https://httpbin.org/headers',
  'https://jsonplaceholder.typicode.com/todos/1',
  'https://jsonplaceholder.typicode.com/todos/2',
  'https://jsonplaceholder.typicode.com/posts/1',
  'https://httpstat.us/200',
  'https://httpstat.us/204',
  'https://httpstat.us/404',
  'https://raw.githubusercontent.com/github/gitignore/main/Node.gitignore',
  'https://cdn.jsdelivr.net/npm/axios/dist/axios.min.js',
  'https://unpkg.com/react/umd/react.production.min.js',
  'https://icanhazip.com',
  'https://ipapi.co/json/',
  'https://github.com/robots.txt',
  'https://www.youtube.com/robots.txt',
  'https://api.github.com',
  'https://api.ipify.org?format=json',
  'https://httpbingo.org/get',
];

function pickRandomUrls(n: number): string[] {
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
    await res.arrayBuffer();
    const t1 = global.performance ? global.performance.now() : Date.now();
    const cached = detectCached(res.headers);
    return { ok: true, ms: t1 - t0, cached } as const;
  } catch (e: any) {
    const t1 = global.performance ? global.performance.now() : Date.now();
    return { ok: false, ms: t1 - t0, error: e?.message ?? String(e) } as const;
  }
}

export function BenchmarkScreen() {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [avgBuiltinNC, setAvgBuiltinNC] = React.useState<number | null>(null);
  const [avgNitroNC, setAvgNitroNC] = React.useState<number | null>(null);
  const [running, setRunning] = React.useState(false);

  const run = React.useCallback(async () => {
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
      const avgBNC = trimmedAverage(
        okRows.filter((r) => r.cachedBuiltin === false).map((r) => r.builtinMs)
      );
      const avgNNC = trimmedAverage(
        okRows.filter((r) => r.cachedNitro === false).map((r) => r.nitroMs)
      );
      setAvgBuiltinNC(avgBNC);
      setAvgNitroNC(avgNNC);
    } finally {
      setRunning(false);
    }
  }, [running]);

  React.useEffect(() => {
    run();
  }, [run]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Benchmark Results</Text>
        <Text style={styles.subtitle}>Nitro vs React Native fetch</Text>
      </View>

      <View style={styles.actionRow}>
        <Pressable
          style={[styles.button, running && styles.buttonDisabled]}
          onPress={run}
          disabled={running}
        >
          <Text style={styles.buttonText}>
            {running ? 'Running Benchmark…' : 'Run Benchmark Again'}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {rows == null ? (
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>
              Warming up engines and running requests…
            </Text>
          </View>
        ) : (
          <View style={styles.resultsCard}>
            <View style={styles.summaryContainer}>
              <View style={styles.summaryBox}>
                <Text style={styles.summaryLabel}>Global Fetch (ms)</Text>
                <Text style={styles.summaryValue}>
                  {avgBuiltinNC?.toFixed(1) ?? '—'}
                </Text>
                <Text style={styles.summarySub}>p10-p90 uncached</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryBox}>
                <Text style={styles.summaryLabel}>Nitro Fetch (ms)</Text>
                <Text style={[styles.summaryValue, styles.nitroColor]}>
                  {avgNitroNC?.toFixed(1) ?? '—'}
                </Text>
                <Text style={styles.summarySub}>p10-p90 uncached</Text>
              </View>
            </View>

            <View style={styles.table}>
              <View style={styles.headerRow}>
                <Text style={[styles.cell, styles.urlCell, styles.headerText]}>
                  URL
                </Text>
                <Text style={[styles.cell, styles.headerText]}>Global</Text>
                <Text style={[styles.cell, styles.headerText]}>Nitro</Text>
                <Text
                  style={[styles.cell, styles.headerText, styles.centerText]}
                >
                  Cache
                </Text>
              </View>

              {rows.map((r) => {
                const builtinWins = r.builtinMs < r.nitroMs;
                const nitroWins = r.nitroMs < r.builtinMs;
                return (
                  <View key={r.url} style={styles.row}>
                    <Text
                      style={[styles.cell, styles.urlCell]}
                      numberOfLines={1}
                    >
                      {r.url.replace(/^https?:\/\//, '')}
                    </Text>
                    <Text
                      style={[
                        styles.cell,
                        styles.numCell,
                        builtinWins && styles.winner,
                      ]}
                    >
                      {r.errorBuiltin
                        ? 'Err'
                        : Number.isFinite(r.builtinMs)
                          ? r.builtinMs.toFixed(0)
                          : '—'}
                    </Text>
                    <Text
                      style={[
                        styles.cell,
                        styles.numCell,
                        nitroWins && styles.winnerNitro,
                      ]}
                    >
                      {r.errorNitro
                        ? 'Err'
                        : Number.isFinite(r.nitroMs)
                          ? r.nitroMs.toFixed(0)
                          : '—'}
                    </Text>
                    <Text style={[styles.cell, styles.cacheCell]}>
                      {r.cachedBuiltin == null
                        ? '?'
                        : r.cachedBuiltin
                          ? 'B✓'
                          : 'B✗'}{' '}
                      {r.cachedNitro == null
                        ? '?'
                        : r.cachedNitro
                          ? 'N✓'
                          : 'N✗'}
                    </Text>
                  </View>
                );
              })}
            </View>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  header: {
    padding: theme.spacing.lg,
    paddingBottom: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: theme.colors.text,
  },
  subtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginTop: 4,
  },
  actionRow: {
    padding: theme.spacing.md,
  },
  button: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
    shadowColor: theme.colors.primary,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    padding: theme.spacing.md,
    paddingBottom: 40,
  },
  loadingContainer: {
    padding: theme.spacing.xl,
    alignItems: 'center',
  },
  loadingText: {
    color: theme.colors.textSecondary,
    fontSize: 16,
  },
  resultsCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.lg,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  summaryContainer: {
    flexDirection: 'row',
    padding: theme.spacing.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    backgroundColor: '#FAFAFC',
  },
  summaryBox: {
    flex: 1,
    alignItems: 'center',
  },
  summaryDivider: {
    width: 1,
    backgroundColor: theme.colors.border,
    marginVertical: theme.spacing.sm,
  },
  summaryLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    fontWeight: '600',
    letterSpacing: 0.5,
  },
  summaryValue: {
    fontSize: 32,
    fontWeight: '800',
    color: theme.colors.text,
    marginVertical: 4,
  },
  nitroColor: {
    color: theme.colors.primary,
  },
  summarySub: {
    fontSize: 11,
    color: theme.colors.textSecondary,
  },
  table: {
    padding: theme.spacing.sm,
  },
  headerRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  headerText: {
    fontWeight: '600',
    color: theme.colors.textSecondary,
    fontSize: 12,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  cell: {
    flex: 1,
    fontSize: 13,
    color: theme.colors.text,
  },
  urlCell: {
    flex: 3,
    paddingRight: 8,
    color: theme.colors.textSecondary,
  },
  numCell: {
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  centerText: {
    textAlign: 'center',
  },
  cacheCell: {
    textAlign: 'center',
    color: theme.colors.textSecondary,
  },
  winner: {
    fontWeight: '600',
    color: theme.colors.text,
  },
  winnerNitro: {
    fontWeight: '700',
    color: theme.colors.primary,
  },
});
