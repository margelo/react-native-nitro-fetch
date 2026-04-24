import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { fetch as nitroFetch } from 'react-native-nitro-fetch';
import { theme } from '../theme';

declare const performance: { now(): number };

type LogLevel = 'info' | 'success' | 'error' | 'warn';
type LogEntry = { ts: string; level: LogLevel; text: string };

export function DevToolsDemoScreen() {
  const [logs, setLogs] = React.useState<LogEntry[]>([]);
  const [busy, setBusy] = React.useState<string | null>(null);

  const log = React.useCallback((level: LogLevel, text: string) => {
    const ts = new Date().toLocaleTimeString();
    setLogs((prev) => [{ ts, level, text }, ...prev].slice(0, 200));
  }, []);

  const run = React.useCallback(
    async (id: string, fn: () => Promise<void>) => {
      setBusy(id);
      try {
        await fn();
      } catch (e: any) {
        log(
          'error',
          `${id} threw: ${e?.name ?? 'Error'} – ${e?.message ?? String(e)}`
        );
      } finally {
        setBusy(null);
      }
    },
    [log]
  );

  // -------- scenarios --------

  const get200 = () =>
    run('get200', async () => {
      const t0 = performance.now();
      const res = await nitroFetch('https://httpbin.org/get?devtools=200');
      const json = await res.json();
      log(
        'success',
        `GET 200 in ${(performance.now() - t0).toFixed(0)}ms · keys=${Object.keys(json).join(',')}`
      );
    });

  const postJson = () =>
    run('postJson', async () => {
      const t0 = performance.now();
      const res = await nitroFetch('https://httpbin.org/post', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          hello: 'devtools',
          nested: { ok: true },
          ts: Date.now(),
        }),
      });
      const json = await res.json();
      log(
        'success',
        `POST 200 in ${(performance.now() - t0).toFixed(0)}ms · echoed json.hello=${json?.json?.hello}`
      );
    });

  const status404 = () =>
    run('status404', async () => {
      const res = await nitroFetch('https://httpstat.us/404');
      const txt = await res.text();
      log('warn', `404 received · body="${txt}" · ok=${res.ok}`);
    });

  const status500 = () =>
    run('status500', async () => {
      const res = await nitroFetch('https://httpstat.us/500');
      const txt = await res.text();
      log('warn', `500 received · body="${txt}" · ok=${res.ok}`);
    });

  const status201Empty = () =>
    run('status201Empty', async () => {
      const res = await nitroFetch('https://httpbin.org/status/201');
      log('success', `201 Created · status=${res.status} · ok=${res.ok}`);
    });

  const redirect302 = () =>
    run('redirect302', async () => {
      const res = await nitroFetch('https://httpbin.org/redirect/2');
      log(
        'success',
        `redirect chain done · final url=${res.url} · status=${res.status}`
      );
    });

  const noFollowRedirect = () =>
    run('noFollow', async () => {
      const res = await nitroFetch('https://httpbin.org/redirect/1', {
        redirect: 'manual',
      });
      log(
        'warn',
        `no-follow · status=${res.status} · location=${res.headers.get('location')}`
      );
    });

  const slowDelay = () =>
    run('slowDelay', async () => {
      const t0 = performance.now();
      const res = await nitroFetch('https://httpbin.org/delay/3');
      log(
        'success',
        `slow GET done in ${(performance.now() - t0).toFixed(0)}ms · status=${res.status}`
      );
    });

  const abortImmediate = () =>
    run('abortImmediate', async () => {
      const ctrl = new AbortController();
      ctrl.abort();
      try {
        await nitroFetch('https://httpbin.org/delay/10', {
          signal: ctrl.signal,
        });
        log('error', 'expected to abort but resolved');
      } catch (e: any) {
        log('success', `aborted immediately · ${e?.name}: ${e?.message}`);
      }
    });

  const abortMidFlight = () =>
    run('abortMid', async () => {
      const ctrl = new AbortController();
      const t0 = performance.now();
      setTimeout(() => ctrl.abort(), 250);
      try {
        await nitroFetch('https://httpbin.org/delay/10', {
          signal: ctrl.signal,
        });
        log('error', 'expected to abort but resolved');
      } catch (e: any) {
        log(
          'success',
          `aborted after ${(performance.now() - t0).toFixed(0)}ms · ${e?.name}: ${e?.message}`
        );
      }
    });

  const streamNdjson = () =>
    run('stream', async () => {
      const res = await nitroFetch('https://httpbin.org/stream/10', {
        stream: true,
      } as any);
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      let chunks = 0;
      let bytes = 0;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks++;
        bytes += value.byteLength;
      }
      log('success', `streamed ${chunks} chunks · ${bytes} bytes total`);
    });

  const bigDownload = () =>
    run('big', async () => {
      const t0 = performance.now();
      const res = await nitroFetch('https://httpbin.org/bytes/524288'); // 512 KB
      const buf = await res.arrayBuffer();
      log(
        'success',
        `512 KB download in ${(performance.now() - t0).toFixed(0)}ms · received=${buf.byteLength}B`
      );
    });

  const dnsFailure = () =>
    run('dnsFail', async () => {
      try {
        await nitroFetch(
          'https://this-host-definitely-does-not-exist.invalid/'
        );
        log('error', 'unexpected success');
      } catch (e: any) {
        log(
          'success',
          `network failure surfaced · ${e?.name ?? 'Error'}: ${e?.message ?? String(e)}`
        );
      }
    });

  const concurrentBurst = () =>
    run('burst', async () => {
      const urls = Array.from(
        { length: 6 },
        (_, i) => `https://httpbin.org/get?burst=${i}`
      );
      const t0 = performance.now();
      const results = await Promise.all(urls.map((u) => nitroFetch(u)));
      log(
        'success',
        `burst of ${results.length} requests in ${(performance.now() - t0).toFixed(0)}ms`
      );
    });

  const customHeaders = () =>
    run('customHeaders', async () => {
      const res = await nitroFetch('https://httpbin.org/headers', {
        headers: {
          'X-Devtools-Demo': 'nitro-fetch',
          'X-Trace-Id': `trace-${Date.now()}`,
          'Authorization': 'Bearer fake-token-for-demo',
        },
      });
      const json = await res.json();
      const echoed = Object.keys(json?.headers ?? {})
        .filter((k) => k.startsWith('X-'))
        .join(',');
      log('success', `custom headers echoed: ${echoed}`);
    });

  // -------- ui --------

  const buttons: {
    id: string;
    title: string;
    desc: string;
    tone: 'ok' | 'warn' | 'error' | 'neutral';
    run: () => void;
  }[] = [
    {
      id: 'get200',
      title: 'GET 200 (JSON)',
      desc: 'Standard JSON response.',
      tone: 'ok',
      run: get200,
    },
    {
      id: 'postJson',
      title: 'POST 200 (JSON body)',
      desc: 'Echoed POST with Content-Type header.',
      tone: 'ok',
      run: postJson,
    },
    {
      id: 'status201Empty',
      title: '201 Created (no body)',
      desc: 'Empty response body.',
      tone: 'ok',
      run: status201Empty,
    },
    {
      id: 'status404',
      title: '404 with response body',
      desc: 'Plain-text "404 Not Found".',
      tone: 'warn',
      run: status404,
    },
    {
      id: 'status500',
      title: '500 with response body',
      desc: 'Plain-text "500 Internal Server Error".',
      tone: 'error',
      run: status500,
    },
    {
      id: 'redirect302',
      title: '302 → 302 → 200',
      desc: 'Two-hop redirect chain (followed).',
      tone: 'neutral',
      run: redirect302,
    },
    {
      id: 'noFollow',
      title: '302 (no follow)',
      desc: 'redirect: "manual" returns the 3xx as-is.',
      tone: 'neutral',
      run: noFollowRedirect,
    },
    {
      id: 'slowDelay',
      title: 'Slow request (3s delay)',
      desc: 'Long-running response timing.',
      tone: 'neutral',
      run: slowDelay,
    },
    {
      id: 'abortImmediate',
      title: 'AbortController – pre-abort',
      desc: 'Signal aborted before send.',
      tone: 'warn',
      run: abortImmediate,
    },
    {
      id: 'abortMid',
      title: 'AbortController – 250ms',
      desc: 'Cancel an in-flight request.',
      tone: 'warn',
      run: abortMidFlight,
    },
    {
      id: 'stream',
      title: 'Streaming (10 chunks)',
      desc: 'Chunked NDJSON via ReadableStream.',
      tone: 'ok',
      run: streamNdjson,
    },
    {
      id: 'big',
      title: 'Binary 512 KB',
      desc: 'Large body, ArrayBuffer response.',
      tone: 'ok',
      run: bigDownload,
    },
    {
      id: 'burst',
      title: 'Concurrent burst (×6)',
      desc: 'Six parallel GETs.',
      tone: 'ok',
      run: concurrentBurst,
    },
    {
      id: 'customHeaders',
      title: 'Custom request headers',
      desc: 'X-* + Authorization echo back.',
      tone: 'ok',
      run: customHeaders,
    },
    {
      id: 'dnsFail',
      title: 'DNS failure',
      desc: 'Unresolvable host – surfaces network error.',
      tone: 'error',
      run: dnsFailure,
    },
  ];

  return (
    <View style={styles.container}>
      <ScrollView style={styles.scrollGrid} contentContainerStyle={styles.grid}>
        <Text style={styles.intro}>
          Trigger requests below. With React Native DevTools open (Metro `j` →
          Network tab), each one should appear with method, status, headers,
          timing and body preview.
        </Text>
        {buttons.map((b) => (
          <Pressable
            key={b.id}
            disabled={busy !== null}
            onPress={b.run}
            style={({ pressed }) => [
              styles.button,
              pressed && styles.pressed,
              busy === b.id && styles.busy,
              toneStyles[b.tone],
            ]}
          >
            <Text style={styles.buttonTitle}>
              {busy === b.id ? '⏳ ' : ''}
              {b.title}
            </Text>
            <Text style={styles.buttonDesc}>{b.desc}</Text>
          </Pressable>
        ))}
      </ScrollView>

      <View style={styles.terminal}>
        <View style={styles.terminalHeader}>
          <Text style={styles.terminalTitle}>Trace</Text>
          <Pressable onPress={() => setLogs([])}>
            <Text style={styles.clearBtn}>Clear</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.terminalScroll}>
          {logs.map((l, i) => (
            <Text key={i} style={[styles.terminalLog, levelColor[l.level]]}>
              [{l.ts}] {iconFor(l.level)} {l.text}
            </Text>
          ))}
          {logs.length === 0 && (
            <Text style={styles.terminalEmpty}>
              Trigger any scenario to populate the trace and the DevTools
              Network tab.
            </Text>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const iconFor = (l: LogLevel) =>
  l === 'success' ? '✅' : l === 'error' ? '❌' : l === 'warn' ? '⚠️' : 'ℹ️';

const toneStyles: Record<'ok' | 'warn' | 'error' | 'neutral', object> = {
  ok: { backgroundColor: '#E5F9E6', borderColor: theme.colors.success },
  warn: { backgroundColor: '#FFF5E5', borderColor: '#FF9500' },
  error: { backgroundColor: '#FFEDF1', borderColor: theme.colors.error },
  neutral: {
    backgroundColor: theme.colors.card,
    borderColor: theme.colors.border,
  },
};

const levelColor: Record<LogLevel, object> = {
  info: { color: '#D4D4D4' },
  success: { color: theme.colors.success },
  warn: { color: '#FFB454' },
  error: { color: theme.colors.error },
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  scrollGrid: { maxHeight: '55%' },
  grid: { padding: theme.spacing.md, gap: theme.spacing.sm },
  intro: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.sm,
    lineHeight: 18,
  },
  button: {
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
  },
  pressed: { opacity: 0.7 },
  busy: { opacity: 0.5 },
  buttonTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: 2,
  },
  buttonDesc: { fontSize: 12, color: theme.colors.textSecondary },
  terminal: { flex: 1, backgroundColor: '#1E1E1E' },
  terminalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: theme.spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: '#333',
    backgroundColor: '#2D2D2D',
  },
  terminalTitle: {
    color: '#CCC',
    fontSize: 12,
    fontWeight: '600',
    textTransform: 'uppercase',
  },
  clearBtn: { color: theme.colors.primary, fontSize: 12, fontWeight: '600' },
  terminalScroll: { padding: theme.spacing.md },
  terminalLog: {
    fontFamily: 'monospace',
    fontSize: 12,
    marginBottom: 6,
    lineHeight: 16,
  },
  terminalEmpty: {
    color: '#666',
    fontFamily: 'monospace',
    textAlign: 'center',
    marginTop: theme.spacing.xl,
  },
});
