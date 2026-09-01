import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import {
  fetch as nitroFetch,
  nitroFetchOnWorklet,
} from 'react-native-nitro-fetch';
import { theme } from '../theme';

declare const performance: any;

const URL = 'https://jsonplaceholder.typicode.com/photos';
const REPEAT = 30;
const PASSES = 3;

type Summary = { items: number; albums: number; titleChars: number };

type PassResult = {
  wallMs: number;
  stallMs: number;
  dropped: number;
  summary: Summary;
};

type ModeResult = {
  passes: PassResult[];
  medWallMs: number;
  maxStallMs: number;
  totalDropped: number;
};

function now(): number {
  return performance && performance.now ? performance.now() : Date.now();
}

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function parseAndAggregate(txt: string): Summary {
  let items = 0;
  let albums = 0;
  let titleChars = 0;
  for (let r = 0; r < REPEAT; r++) {
    const arr = JSON.parse(txt) as Array<{ albumId: number; title: string }>;
    items = arr.length;
    const seen: Record<number, boolean> = {};
    let count = 0;
    let chars = 0;
    for (let i = 0; i < arr.length; i++) {
      const it = arr[i]!;
      if (!seen[it.albumId]) {
        seen[it.albumId] = true;
        count++;
      }
      chars += it.title.length;
    }
    albums = count;
    titleChars = chars;
  }
  return { items, albums, titleChars };
}

function startStallMeter() {
  let last = now();
  let maxGap = 0;
  let ticks = 0;
  const t0 = now();
  const id = setInterval(() => {
    const t = now();
    const gap = t - last;
    if (gap > maxGap) maxGap = gap;
    last = t;
    ticks++;
  }, 16);
  return () => {
    const finalGap = now() - last;
    if (finalGap > maxGap) maxGap = finalGap;
    clearInterval(id);
    const elapsed = now() - t0;
    const expected = Math.max(1, Math.floor(elapsed / 16));
    return {
      stallMs: maxGap,
      dropped: Math.max(0, expected - ticks),
    };
  };
}

async function runJsPass(): Promise<PassResult> {
  const stop = startStallMeter();
  const t0 = now();
  const res = await nitroFetch(URL);
  const txt = await res.text();
  const tp = now();
  const summary = parseAndAggregate(txt);
  console.log(
    `[WorkletJsonBench] js parse ${(now() - tp).toFixed(1)}ms bytes=${
      txt.length
    }`
  );
  const wallMs = now() - t0;
  const { stallMs, dropped } = stop();
  return { wallMs, stallMs, dropped, summary };
}

async function runWorkletPass(): Promise<PassResult> {
  const stop = startStallMeter();
  const t0 = now();
  const summary = await nitroFetchOnWorklet(
    URL,
    undefined,
    (payload: { bodyString?: string }) => {
      'worklet';
      const txt = payload.bodyString ?? '';
      let items = 0;
      let albums = 0;
      let titleChars = 0;
      for (let r = 0; r < REPEAT; r++) {
        const arr = JSON.parse(txt) as Array<{
          albumId: number;
          title: string;
        }>;
        items = arr.length;
        const seen: Record<number, boolean> = {};
        let count = 0;
        let chars = 0;
        for (let i = 0; i < arr.length; i++) {
          const it = arr[i]!;
          if (!seen[it.albumId]) {
            seen[it.albumId] = true;
            count++;
          }
          chars += it.title.length;
        }
        albums = count;
        titleChars = chars;
      }
      return { items, albums, titleChars };
    },
    { preferBytes: false }
  );
  const wallMs = now() - t0;
  const { stallMs, dropped } = stop();
  return { wallMs, stallMs, dropped, summary };
}

async function measureIdleBaseline(ms: number): Promise<number> {
  const stop = startStallMeter();
  await new Promise((r) => setTimeout(r, ms));
  return stop().stallMs;
}

function aggregate(passes: PassResult[]): ModeResult {
  return {
    passes,
    medWallMs: median(passes.map((p) => p.wallMs)),
    maxStallMs: Math.max(...passes.map((p) => p.stallMs)),
    totalDropped: passes.reduce((a, p) => a + p.dropped, 0),
  };
}

export function WorkletJsonBenchmarkScreen() {
  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState('');
  const [jsResult, setJsResult] = React.useState<ModeResult | null>(null);
  const [workletResult, setWorkletResult] = React.useState<ModeResult | null>(
    null
  );
  const [error, setError] = React.useState<string | null>(null);
  const [baselineMs, setBaselineMs] = React.useState<number | null>(null);
  const [beat, setBeat] = React.useState(0);

  React.useEffect(() => {
    const id = setInterval(() => setBeat((b) => b + 1), 100);
    return () => clearInterval(id);
  }, []);

  const run = React.useCallback(async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    setJsResult(null);
    setWorkletResult(null);
    setBaselineMs(null);
    try {
      setProgress('Measuring idle baseline…');
      setBaselineMs(await measureIdleBaseline(600));
      setProgress('Warming up (untimed)…');
      await runJsPass();
      await runWorkletPass();
      const jsPasses: PassResult[] = [];
      const wkPasses: PassResult[] = [];
      for (let pass = 1; pass <= PASSES; pass++) {
        setProgress(`Pass ${pass}/${PASSES} · JS thread…`);
        await new Promise((r) => setTimeout(r, 100));
        jsPasses.push(await runJsPass());
        setProgress(`Pass ${pass}/${PASSES} · Worklet…`);
        await new Promise((r) => setTimeout(r, 100));
        wkPasses.push(await runWorkletPass());
      }
      setJsResult(aggregate(jsPasses));
      setWorkletResult(aggregate(wkPasses));
    } catch (e: any) {
      setError(e?.message ?? String(e));
    } finally {
      setRunning(false);
      setProgress('');
    }
  }, [running]);

  const stallRatio =
    jsResult && workletResult && workletResult.maxStallMs > 0
      ? jsResult.maxStallMs / workletResult.maxStallMs
      : null;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Worklet JSON Benchmark</Text>
        <Text style={styles.subtitle}>
          ~1MB JSON (5000 photos) · parse + aggregate ×{REPEAT} per pass ·{' '}
          {PASSES} passes per mode
        </Text>
        <Text style={styles.subtitleSmall}>
          Same endpoint and parse work in both modes — the execution path and
          thread differ.
        </Text>
      </View>

      <View style={styles.heartbeatCard}>
        <Text style={styles.heartbeatLabel}>
          JS thread heartbeat — freezes when JS is blocked
        </Text>
        <View style={styles.heartbeatTrack}>
          <View
            style={[styles.heartbeatDot, { left: `${(beat * 7) % 100}%` }]}
          />
        </View>
      </View>

      <View style={styles.actionRow}>
        <Pressable
          style={[styles.button, running && styles.buttonDisabled]}
          onPress={run}
          disabled={running}
        >
          <Text style={styles.buttonText}>
            {running ? progress || 'Running…' : 'Run Benchmark'}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
      >
        {error ? (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{error}</Text>
          </View>
        ) : null}

        {jsResult == null && !error ? (
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>
              {running
                ? 'Running… watch the heartbeat dot above.\nIt stutters during JS-thread passes and stays smooth during worklet passes.'
                : 'Tap "Run Benchmark". Watch the heartbeat dot while it runs.'}
            </Text>
          </View>
        ) : null}

        {jsResult && workletResult ? (
          <>
            {stallRatio != null ? (
              <View style={styles.verdictCard}>
                <Text style={styles.verdictBig}>
                  {stallRatio.toFixed(1)}× smaller max JS timer gap
                </Text>
                <Text style={styles.verdictSub}>
                  Longest JS timer gap: {jsResult.maxStallMs.toFixed(0)}ms on JS
                  thread vs {workletResult.maxStallMs.toFixed(0)}ms with
                  nitroFetchOnWorklet
                </Text>
              </View>
            ) : null}

            <ResultCard
              title="JS thread (fetch + res.text() + JSON.parse)"
              result={jsResult}
              accent={theme.colors.error}
            />
            <ResultCard
              title="Worklet (nitroFetchOnWorklet)"
              result={workletResult}
              accent={theme.colors.success}
            />

            <View style={styles.legend}>
              <Text style={styles.legendText}>
                "Max JS gap" = longest gap between 16ms timer ticks on the JS
                thread. Gaps above ~32ms can indicate visible UI stalls.
              </Text>
              <Text style={styles.legendText}>
                Idle timer gap before the run: {baselineMs?.toFixed(0)}ms.
              </Text>
              <Text style={styles.legendText}>
                Wall time is similar in both modes (the work is the same); the
                win is that the worklet keeps the JS thread free to render UI
                and handle touches.
              </Text>
              <Text style={styles.legendText}>
                Parsed {jsResult.passes[0]?.summary.items ?? 0} items ·{' '}
                {jsResult.passes[0]?.summary.albums ?? 0} albums per parse in
                both modes.
              </Text>
            </View>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

function ResultCard({
  title,
  result,
  accent,
}: {
  title: string;
  result: ModeResult;
  accent: string;
}) {
  return (
    <View style={styles.resultsCard}>
      <View style={[styles.resultsHeader, { borderLeftColor: accent }]}>
        <Text style={styles.resultsTitle}>{title}</Text>
      </View>
      <View style={styles.statsRow}>
        <Stat label="med wall" value={`${result.medWallMs.toFixed(0)}ms`} />
        <Stat
          label="max JS gap"
          value={`${result.maxStallMs.toFixed(0)}ms`}
          color={accent}
        />
        <Stat label="dropped ticks" value={`${result.totalDropped}`} />
      </View>
      <View style={styles.tableHeader}>
        <Text style={[styles.cell, styles.headerText]}>Pass</Text>
        <Text style={[styles.cell, styles.numCell, styles.headerText]}>
          wall ms
        </Text>
        <Text style={[styles.cell, styles.numCell, styles.headerText]}>
          stall ms
        </Text>
        <Text style={[styles.cell, styles.numCell, styles.headerText]}>
          dropped
        </Text>
      </View>
      {result.passes.map((p, i) => (
        <View key={i} style={styles.row}>
          <Text style={styles.cell}>{i + 1}</Text>
          <Text style={[styles.cell, styles.numCell]}>
            {p.wallMs.toFixed(0)}
          </Text>
          <Text style={[styles.cell, styles.numCell]}>
            {p.stallMs.toFixed(0)}
          </Text>
          <Text style={[styles.cell, styles.numCell]}>{p.dropped}</Text>
        </View>
      ))}
    </View>
  );
}

function Stat({
  label,
  value,
  color,
}: {
  label: string;
  value: string;
  color?: string;
}) {
  return (
    <View style={styles.stat}>
      <Text style={[styles.statValue, color != null && { color }]}>
        {value}
      </Text>
      <Text style={styles.statLabel}>{label}</Text>
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
  subtitleSmall: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginTop: 2,
    fontStyle: 'italic',
  },
  heartbeatCard: {
    margin: theme.spacing.md,
    marginBottom: 0,
    padding: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.md,
  },
  heartbeatLabel: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginBottom: theme.spacing.sm,
  },
  heartbeatTrack: {
    height: 14,
    borderRadius: 7,
    backgroundColor: theme.colors.background,
    overflow: 'hidden',
  },
  heartbeatDot: {
    position: 'absolute',
    top: 2,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: theme.colors.primary,
  },
  actionRow: {
    padding: theme.spacing.md,
  },
  button: {
    backgroundColor: theme.colors.primary,
    paddingVertical: 14,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
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
    paddingTop: 0,
    paddingBottom: 40,
    gap: theme.spacing.md,
  },
  loadingContainer: {
    padding: theme.spacing.xl,
    alignItems: 'center',
  },
  loadingText: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  errorCard: {
    padding: theme.spacing.md,
    backgroundColor: '#FFE5E5',
    borderRadius: theme.borderRadius.md,
  },
  errorText: {
    color: theme.colors.error,
    fontSize: 14,
  },
  verdictCard: {
    padding: theme.spacing.lg,
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.lg,
    alignItems: 'center',
  },
  verdictBig: {
    fontSize: 22,
    fontWeight: '800',
    color: theme.colors.success,
  },
  verdictSub: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginTop: 4,
    textAlign: 'center',
  },
  resultsCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.lg,
    overflow: 'hidden',
  },
  resultsHeader: {
    padding: theme.spacing.md,
    borderLeftWidth: 4,
  },
  resultsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
  },
  statsRow: {
    flexDirection: 'row',
    paddingHorizontal: theme.spacing.md,
    paddingBottom: theme.spacing.md,
    gap: theme.spacing.md,
  },
  stat: {
    flex: 1,
    alignItems: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: '700',
    color: theme.colors.text,
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    backgroundColor: '#FAFAFC',
  },
  headerText: {
    fontWeight: '600',
    color: theme.colors.textSecondary,
    fontSize: 11,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: theme.spacing.md,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  cell: {
    flex: 1,
    fontSize: 12,
    color: theme.colors.text,
  },
  numCell: {
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  legend: {
    padding: theme.spacing.md,
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.md,
  },
  legendText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginBottom: 4,
  },
});
