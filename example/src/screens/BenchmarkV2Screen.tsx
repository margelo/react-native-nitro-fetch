import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Pressable,
  Switch,
} from 'react-native';
import { theme } from '../theme';
import {
  runHeadToHeadRepeated,
  runPrefetch,
  waitForIdle,
  median,
  summarizeRuns,
  JsLoadGenerator,
  PREFETCH_ITERATIONS,
  REPEAT_RUNS,
  type PrefetchResult,
  type H2HRun,
} from './benchmarkV2/methodology';

type Progress = { label: string; done: number; total: number } | null;

function fmt(n: number | null | undefined): string {
  return n == null ? '—' : n.toFixed(0);
}

export function BenchmarkV2Screen() {
  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState<Progress>(null);
  const [pf, setPf] = React.useState<PrefetchResult[] | null>(null);
  const [runs, setRuns] = React.useState<H2HRun[] | null>(null);
  const [simulateLoad, setSimulateLoad] = React.useState(false);

  const onProgress = React.useCallback(
    async (label: string, done: number, total: number) => {
      setProgress({ label, done, total });
      await waitForIdle();
    },
    []
  );

  const withLoad = React.useCallback(
    async <T,>(fn: () => Promise<T>): Promise<T> => {
      const gen = simulateLoad ? new JsLoadGenerator() : null;
      gen?.start();
      try {
        return await fn();
      } finally {
        gen?.stop();
      }
    },
    [simulateLoad]
  );

  const runBenchmark = React.useCallback(async () => {
    if (running) return;
    setRunning(true);
    setRuns(null);
    setProgress({ label: 'starting', done: 0, total: 1 });
    const onRunProgress = async (
      run: number,
      totalRuns: number,
      label: string,
      done: number,
      total: number
    ) => {
      setProgress({
        label: `run ${run + 1}/${totalRuns}: ${label}`,
        done,
        total,
      });
      await waitForIdle();
    };
    try {
      const res = await withLoad(() =>
        runHeadToHeadRepeated(REPEAT_RUNS, onRunProgress)
      );
      setRuns(res);
    } finally {
      setProgress(null);
      setRunning(false);
    }
  }, [running, withLoad]);

  const runPf = React.useCallback(async () => {
    if (running) return;
    setRunning(true);
    setPf(null);
    setProgress({ label: 'starting', done: 0, total: 1 });
    try {
      const res = await withLoad(() => runPrefetch(onProgress));
      setPf(res);
    } finally {
      setProgress(null);
      setRunning(false);
    }
  }, [running, onProgress, withLoad]);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Benchmark V2</Text>
        <Text style={styles.subtitle}>
          Built-in fetch vs Nitro · stall-corrected
        </Text>
      </View>

      <View style={styles.card}>
        <View style={styles.switchRow}>
          <Text style={styles.switchLabel}>Simulate JS thread load</Text>
          <Switch
            value={simulateLoad}
            onValueChange={setSimulateLoad}
            disabled={running}
          />
        </View>

        <View style={styles.btnRow}>
          <Pressable
            style={[styles.button, running && styles.buttonDisabled]}
            onPress={runBenchmark}
            disabled={running}
          >
            <Text style={styles.buttonText}>Run Benchmark ×{REPEAT_RUNS}</Text>
          </Pressable>
          <Pressable
            style={[
              styles.button,
              styles.secondaryBtn,
              running && styles.buttonDisabled,
            ]}
            onPress={runPf}
            disabled={running}
          >
            <Text style={[styles.buttonText, styles.secondaryBtnText]}>
              Run Prefetch
            </Text>
          </Pressable>
        </View>

        {progress && (
          <Text style={styles.progress}>
            {progress.label === 'done' || progress.done >= progress.total
              ? 'Computing results…'
              : `Measuring ${progress.label} (${progress.done + 1}/${progress.total})…`}
          </Text>
        )}
      </View>

      {runs && <RunsTable rows={runs} />}
      {pf && <PrefetchResults rows={pf} />}
    </ScrollView>
  );
}

function pctStr(p: number | null): string {
  return p == null ? '—' : p.toFixed(1) + '%';
}

function RunsTable({ rows }: { rows: H2HRun[] }) {
  const s = summarizeRuns(rows);

  return (
    <View style={styles.resultsCard}>
      <Text style={styles.resultsTitle}>{rows.length} runs</Text>
      <View style={styles.summaryRow}>
        <Summary label="Built-in avg" value={fmt(s.builtinAvg)} />
        <Summary label="Nitro avg" value={fmt(s.nitroAvg)} accent />
        <Summary label="Nitro faster" value={pctStr(s.avgPct)} accent />
      </View>
      <Text style={styles.trustLine}>
        median {fmt(s.builtinMedian)} → {fmt(s.nitroMedian)}ms (
        {pctStr(s.medianPct)}, {s.medianSpeedup?.toFixed(2) ?? '—'}×) ·{' '}
        {s.totalDiscarded} discarded · {s.totalErrors} errors
      </Text>

      <View style={styles.tableHeader}>
        <Text style={[styles.th, styles.colRun]}>Run</Text>
        <Text style={[styles.th, styles.colNum]}>B-in</Text>
        <Text style={[styles.th, styles.colNum]}>Nitro</Text>
        <Text style={[styles.th, styles.colNum]}>×</Text>
        <Text style={[styles.th, styles.colNum]}>%</Text>
        <Text style={[styles.th, styles.colNum]}>Drop</Text>
      </View>
      {rows.map((r) => (
        <View key={r.run} style={styles.tableRow}>
          <Text style={[styles.td, styles.colRun]}>{r.run}</Text>
          <Text style={[styles.td, styles.colNum]}>{fmt(r.builtinMedian)}</Text>
          <Text style={[styles.td, styles.colNum, styles.winnerNitro]}>
            {fmt(r.nitroMedian)}
          </Text>
          <Text style={[styles.td, styles.colNum]}>
            {r.speedup == null ? '—' : r.speedup.toFixed(2)}
          </Text>
          <Text style={[styles.td, styles.colNum]}>{pctStr(r.pct)}</Text>
          <Text style={[styles.td, styles.colNum, styles.dropText]}>
            {r.discarded}
          </Text>
        </View>
      ))}
      <View style={[styles.tableRow, styles.footerRow]}>
        <Text style={[styles.td, styles.colRun, styles.footerText]}>Med</Text>
        <Text style={[styles.td, styles.colNum, styles.footerText]}>
          {fmt(s.builtinMedian)}
        </Text>
        <Text style={[styles.td, styles.colNum, styles.footerText]}>
          {fmt(s.nitroMedian)}
        </Text>
        <Text style={[styles.td, styles.colNum, styles.footerText]}>
          {s.medianSpeedup?.toFixed(2) ?? '—'}
        </Text>
        <Text style={[styles.td, styles.colNum, styles.footerText]}>
          {pctStr(s.medianPct)}
        </Text>
        <Text style={[styles.td, styles.colNum, styles.footerText]}>—</Text>
      </View>
      <View style={[styles.tableRow, styles.footerRow]}>
        <Text style={[styles.td, styles.colRun, styles.footerText]}>Avg</Text>
        <Text style={[styles.td, styles.colNum, styles.footerText]}>
          {fmt(s.builtinAvg)}
        </Text>
        <Text style={[styles.td, styles.colNum, styles.footerText]}>
          {fmt(s.nitroAvg)}
        </Text>
        <Text style={[styles.td, styles.colNum, styles.footerText]}>
          {s.avgSpeedup?.toFixed(2) ?? '—'}
        </Text>
        <Text style={[styles.td, styles.colNum, styles.footerText]}>
          {pctStr(s.avgPct)}
        </Text>
        <Text style={[styles.td, styles.colNum, styles.footerText]}>—</Text>
      </View>
    </View>
  );
}

function PrefetchResults({ rows }: { rows: PrefetchResult[] }) {
  const coldNitro = median(
    rows.map((r) => r.nitroCold.median).filter((x): x is number => x != null)
  );
  const prefetched = median(
    rows
      .map((r) => r.nitroPrefetched.median)
      .filter((x): x is number => x != null)
  );
  const hits = rows.reduce((s, r) => s + r.hits, 0);
  const misses = rows.reduce((s, r) => s + r.misses, 0);

  return (
    <View style={styles.resultsCard}>
      <Text style={styles.resultsTitle}>Prefetch consume (median ms)</Text>
      <View style={styles.summaryRow}>
        <Summary label="Nitro cold" value={fmt(coldNitro)} />
        <Summary label="Prefetched" value={fmt(prefetched)} accent />
      </View>
      <Text style={styles.trustLine}>
        {hits} confirmed hits · {misses} misses
      </Text>

      <View style={styles.tableHeader}>
        <Text style={[styles.th, styles.colUrl]}>Endpoint</Text>
        <Text style={[styles.th, styles.colNum]}>B-in</Text>
        <Text style={[styles.th, styles.colNum]}>Cold</Text>
        <Text style={[styles.th, styles.colNum]}>Pre</Text>
        <Text style={[styles.th, styles.colNum]}>Hit</Text>
      </View>
      {rows.map((r) => (
        <View key={r.label} style={styles.tableRow}>
          <View style={styles.colUrl}>
            <Text style={styles.urlText} numberOfLines={1}>
              {r.label}
            </Text>
          </View>
          <Text style={[styles.td, styles.colNum]}>
            {fmt(r.builtinCold.median)}
          </Text>
          <Text style={[styles.td, styles.colNum]}>
            {fmt(r.nitroCold.median)}
          </Text>
          <Text style={[styles.td, styles.colNum, styles.winnerNitro]}>
            {fmt(r.nitroPrefetched.median)}
          </Text>
          <Text style={[styles.td, styles.colNum]}>
            {r.hits}/{PREFETCH_ITERATIONS}
          </Text>
        </View>
      ))}
    </View>
  );
}

function Summary({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <View style={styles.summaryBox}>
      <Text style={styles.summaryLabel}>{label}</Text>
      <Text style={[styles.summaryValue, accent && styles.accentValue]}>
        {value}
      </Text>
      <Text style={styles.summaryUnit}>ms</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.colors.background },
  content: { padding: theme.spacing.md, paddingBottom: 48 },
  header: { marginBottom: theme.spacing.md },
  title: { fontSize: 26, fontWeight: '800', color: theme.colors.text },
  subtitle: {
    fontSize: 14,
    color: theme.colors.textSecondary,
    marginTop: 4,
  },
  card: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: theme.spacing.md,
  },
  switchLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: theme.colors.text,
  },
  btnRow: { flexDirection: 'row', gap: theme.spacing.sm },
  button: {
    flex: 1,
    backgroundColor: theme.colors.primary,
    paddingVertical: 12,
    borderRadius: theme.borderRadius.md,
    alignItems: 'center',
  },
  secondaryBtn: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.primary,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: '#FFF', fontSize: 15, fontWeight: '700' },
  secondaryBtnText: { color: theme.colors.primary },
  progress: {
    marginTop: theme.spacing.md,
    fontSize: 13,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  resultsCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.lg,
    padding: theme.spacing.md,
    marginBottom: theme.spacing.md,
  },
  resultsTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.sm,
  },
  summaryRow: { flexDirection: 'row', marginBottom: theme.spacing.sm },
  summaryBox: { flex: 1, alignItems: 'center' },
  summaryLabel: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    textTransform: 'uppercase',
    fontWeight: '600',
    letterSpacing: 0.4,
  },
  summaryValue: {
    fontSize: 30,
    fontWeight: '800',
    color: theme.colors.text,
  },
  accentValue: { color: theme.colors.primary },
  summaryUnit: { fontSize: 11, color: theme.colors.textSecondary },
  trustLine: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginBottom: theme.spacing.sm,
  },
  tableHeader: {
    flexDirection: 'row',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
    paddingBottom: 6,
    marginTop: 4,
  },
  th: {
    fontSize: 11,
    fontWeight: '700',
    color: theme.colors.textSecondary,
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EFEFF2',
  },
  colUrl: { flex: 3, paddingRight: 6 },
  colRun: { flex: 1, fontVariant: ['tabular-nums'] },
  colNum: {
    flex: 1,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  urlText: { fontSize: 13, color: theme.colors.text },
  td: { fontSize: 13, color: theme.colors.text },
  winnerNitro: { color: theme.colors.primary, fontWeight: '700' },
  dropText: { color: theme.colors.textSecondary, fontSize: 12 },
  footerRow: {
    borderBottomWidth: 0,
    borderTopWidth: 1,
    borderTopColor: theme.colors.border,
  },
  footerText: { fontWeight: '700' },
});
