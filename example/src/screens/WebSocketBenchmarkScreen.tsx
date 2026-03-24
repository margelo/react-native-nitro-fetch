import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import {
  NitroWebSocket,
  prewarmOnAppStart,
} from 'react-native-nitro-websockets';
import { theme } from '../theme';

declare const performance: { now(): number };
declare const global: any;

const ECHO_URL = 'wss://echo.websocket.org';
const MESSAGE_COUNT = 200;

// Persist the echo URL to the prewarm queue so native auto-bootstrap
// can pre-connect on the next cold launch — runs once per install.
prewarmOnAppStart(ECHO_URL);
const RUNS = 3;

type RunResult = {
  connectMs: number; // time from start → onopen
  roundtripMs: number; // time from first send → last echo received
  closeMs: number; // time from ws.close() → onclose
  totalMs: number; // end-to-end
};

type BenchResult = {
  runs: RunResult[];
  avg: RunResult;
};

function avgResults(runs: RunResult[]): RunResult {
  const n = runs.length;
  return {
    connectMs: runs.reduce((s, r) => s + r.connectMs, 0) / n,
    roundtripMs: runs.reduce((s, r) => s + r.roundtripMs, 0) / n,
    closeMs: runs.reduce((s, r) => s + r.closeMs, 0) / n,
    totalMs: runs.reduce((s, r) => s + r.totalMs, 0) / n,
  };
}

function runNitro(): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    let tOpen = 0,
      tSend = 0,
      tLastEcho = 0,
      tClose = 0;
    let received = 0;

    const ws = new NitroWebSocket(ECHO_URL);

    ws.onopen = () => {
      tOpen = performance.now();
      tSend = performance.now();
      for (let i = 0; i < MESSAGE_COUNT; i++) ws.send(`nitro-${i}`);
    };

    ws.onmessage = () => {
      received++;
      if (received === MESSAGE_COUNT) {
        tLastEcho = performance.now();
        tClose = performance.now();
        ws.close(1000, '');
      }
    };

    ws.onclose = () => {
      resolve({
        connectMs: tOpen - t0,
        roundtripMs: tLastEcho - tSend,
        closeMs: performance.now() - tClose,
        totalMs: performance.now() - t0,
      });
    };

    ws.onerror = (err: string) => reject(new Error(err));
  });
}

function runBuiltin(): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const t0 = performance.now();
    let tOpen = 0,
      tSend = 0,
      tLastEcho = 0,
      tClose = 0;
    let received = 0;

    const ws: any = new global.WebSocket(ECHO_URL);

    ws.onopen = () => {
      tOpen = performance.now();
      tSend = performance.now();
      for (let i = 0; i < MESSAGE_COUNT; i++) ws.send(`builtin-${i}`);
    };

    ws.onmessage = () => {
      received++;
      if (received === MESSAGE_COUNT) {
        tLastEcho = performance.now();
        tClose = performance.now();
        ws.close(1000, '');
      }
    };

    ws.onclose = () => {
      resolve({
        connectMs: tOpen - t0,
        roundtripMs: tLastEcho - tSend,
        closeMs: performance.now() - tClose,
        totalMs: performance.now() - t0,
      });
    };

    ws.onerror = () => reject(new Error('Built-in WebSocket error'));
  });
}

const PAUSE_MS = 300;

async function runAlternating(
  onProgress: (index: number, kind: 'nitro' | 'builtin') => void,
  onPartial: (nitro: RunResult[], builtin: RunResult[]) => void
): Promise<{ nitro: BenchResult; builtin: BenchResult }> {
  const nitroRuns: RunResult[] = [];
  const builtinRuns: RunResult[] = [];
  let step = 0;

  for (let i = 0; i < RUNS; i++) {
    step += 1;
    onProgress(step, 'nitro');
    nitroRuns.push(await runNitro());
    onPartial(nitroRuns, builtinRuns);
    await new Promise<void>((r) => setTimeout(r, PAUSE_MS));

    step += 1;
    onProgress(step, 'builtin');
    builtinRuns.push(await runBuiltin());
    onPartial(nitroRuns, builtinRuns);
    await new Promise<void>((r) => setTimeout(r, PAUSE_MS));
  }

  return {
    nitro: { runs: nitroRuns, avg: avgResults(nitroRuns) },
    builtin: { runs: builtinRuns, avg: avgResults(builtinRuns) },
  };
}

type Phase = 'idle' | 'running' | 'done';

export function WebSocketBenchmarkScreen() {
  const [phase, setPhase] = React.useState<Phase>('idle');
  const [run, setRun] = React.useState(0);
  const [runKind, setRunKind] = React.useState<'nitro' | 'builtin'>('nitro');
  const [nitroResult, setNitroResult] = React.useState<BenchResult | null>(
    null
  );
  const [builtinResult, setBuiltinResult] = React.useState<BenchResult | null>(
    null
  );
  const [error, setError] = React.useState<string | null>(null);

  const start = async () => {
    setError(null);
    setNitroResult(null);
    setBuiltinResult(null);

    try {
      setPhase('running');
      const { nitro: nr, builtin: br } = await runAlternating(
        (index, kind) => {
          setRun(index);
          setRunKind(kind);
        },
        (nRuns, bRuns) => {
          if (nRuns.length > 0) {
            setNitroResult({ runs: [...nRuns], avg: avgResults(nRuns) });
          }
          if (bRuns.length > 0) {
            setBuiltinResult({ runs: [...bRuns], avg: avgResults(bRuns) });
          }
        }
      );
      setNitroResult(nr);
      setBuiltinResult(br);

      setPhase('done');
    } catch (e: any) {
      setError(e?.message ?? 'Unknown error');
      setPhase('idle');
    }
  };

  const running = phase === 'running';
  const totalAlternateRuns = RUNS * 2;

  const diff = (nitro: number, builtin: number) => {
    const pct = ((builtin - nitro) / builtin) * 100;
    return { pct, faster: pct > 0 };
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.title}>WebSocket Benchmark</Text>
        <Text style={styles.subtitle}>
          connect → send {MESSAGE_COUNT} messages → disconnect ({RUNS}× each,
          nitro / built-in alternating)
        </Text>
        <Text style={styles.server}>{ECHO_URL}</Text>
      </View>

      {/* Run button */}
      <Pressable
        style={[styles.btn, running && styles.btnDisabled]}
        onPress={running ? undefined : start}
        disabled={running}
      >
        {running ? (
          <View style={styles.btnRow}>
            <ActivityIndicator
              size="small"
              color="#FFF"
              style={styles.spinner}
            />
            <Text style={styles.btnText}>
              {runKind === 'nitro' ? 'Nitro' : 'Built-in'} — {run}/
              {totalAlternateRuns}
            </Text>
          </View>
        ) : (
          <Text style={styles.btnText}>
            {phase === 'done' ? 'Run Again' : 'Run Benchmark'}
          </Text>
        )}
      </Pressable>

      {error && <Text style={styles.error}>{error}</Text>}

      {/* Results */}
      {(nitroResult || builtinResult) && (
        <View style={styles.card}>
          {/* Column headers */}
          <View style={styles.row}>
            <Text style={[styles.cell, styles.labelCell]} />
            <Text style={[styles.cell, styles.colHead, styles.nitroCol]}>
              Nitro
            </Text>
            <Text style={[styles.cell, styles.colHead, styles.builtinCol]}>
              Built-in
            </Text>
            <Text style={[styles.cell, styles.colHead, styles.diffCol]}>
              Diff
            </Text>
          </View>

          {(
            [
              { label: 'Connect', key: 'connectMs' },
              { label: `${MESSAGE_COUNT} msg RTT`, key: 'roundtripMs' },
              { label: 'Close', key: 'closeMs' },
              { label: 'Total', key: 'totalMs' },
            ] as const
          ).map(({ label, key }, idx) => {
            const n = nitroResult?.avg[key];
            const b = builtinResult?.avg[key];
            const d = n != null && b != null ? diff(n, b) : null;
            return (
              <View
                key={key}
                style={[styles.row, idx % 2 === 1 && styles.rowAlt]}
              >
                <Text style={[styles.cell, styles.labelCell]}>{label}</Text>
                <Text style={[styles.cell, styles.nitroCol, styles.mono]}>
                  {n != null ? `${n.toFixed(1)}ms` : '—'}
                </Text>
                <Text style={[styles.cell, styles.builtinCol, styles.mono]}>
                  {b != null ? `${b.toFixed(1)}ms` : running ? '…' : '—'}
                </Text>
                <Text
                  style={[
                    styles.cell,
                    styles.diffCol,
                    styles.mono,
                    d ? (d.faster ? styles.faster : styles.slower) : undefined,
                  ]}
                >
                  {d
                    ? `${d.faster ? '-' : '+'}${Math.abs(d.pct).toFixed(1)}%`
                    : '—'}
                </Text>
              </View>
            );
          })}
        </View>
      )}

      {/* Per-run breakdown */}
      {(nitroResult || builtinResult) && (
        <View style={styles.card}>
          <Text style={styles.sectionTitle}>Per-run totals (ms)</Text>
          <View style={styles.row}>
            <Text style={[styles.cell, styles.labelCell]} />
            {Array.from({ length: RUNS }, (_, i) => (
              <Text
                key={i}
                style={[styles.cell, styles.runCol, styles.colHead]}
              >
                Run {i + 1}
              </Text>
            ))}
          </View>
          {[
            { label: 'Nitro', result: nitroResult },
            { label: 'Built-in', result: builtinResult },
          ].map(({ label, result }, ri) => (
            <View
              key={label}
              style={[styles.row, ri % 2 === 1 && styles.rowAlt]}
            >
              <Text style={[styles.cell, styles.labelCell]}>{label}</Text>
              {Array.from({ length: RUNS }, (_, i) => {
                const done = result?.runs[i];
                const inFlight =
                  running &&
                  runKind === (ri === 0 ? 'nitro' : 'builtin') &&
                  (result?.runs.length ?? 0) === i;
                return (
                  <Text
                    key={i}
                    style={[styles.cell, styles.runCol, styles.mono]}
                  >
                    {done != null
                      ? done.totalMs.toFixed(1)
                      : inFlight
                        ? '…'
                        : '—'}
                  </Text>
                );
              })}
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
  },
  content: {
    padding: theme.spacing.md,
    gap: theme.spacing.md,
    paddingBottom: theme.spacing.xl * 2,
  },
  header: {
    alignItems: 'center',
    gap: 4,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: theme.colors.text,
  },
  subtitle: {
    fontSize: 13,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  server: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    fontFamily: 'monospace',
  },
  btn: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    paddingVertical: theme.spacing.md,
    alignItems: 'center',
  },
  btnDisabled: {
    opacity: 0.7,
  },
  btnRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: theme.spacing.sm,
  },
  btnText: {
    color: '#FFF',
    fontSize: 15,
    fontWeight: '600',
  },
  spinner: {
    transform: [{ scale: 0.85 }],
  },
  error: {
    color: theme.colors.error,
    fontSize: 13,
    textAlign: 'center',
  },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.md,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textSecondary,
    paddingHorizontal: theme.spacing.md,
    paddingTop: theme.spacing.sm,
    paddingBottom: 4,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  rowAlt: {
    backgroundColor: theme.colors.background,
  },
  cell: {
    fontSize: 13,
    color: theme.colors.text,
    textAlign: 'right',
  },
  labelCell: {
    flex: 1.2,
    textAlign: 'left',
    color: theme.colors.textSecondary,
    fontSize: 12,
  },
  colHead: {
    fontWeight: '600',
    color: theme.colors.textSecondary,
    fontSize: 11,
    textTransform: 'uppercase',
  },
  nitroCol: {
    flex: 1,
  },
  builtinCol: {
    flex: 1,
  },
  diffCol: {
    flex: 0.9,
  },
  runCol: {
    flex: 1,
  },
  mono: {
    fontFamily: 'monospace',
  },
  faster: {
    color: theme.colors.success,
    fontWeight: '600',
  },
  slower: {
    color: theme.colors.error,
    fontWeight: '600',
  },
});
