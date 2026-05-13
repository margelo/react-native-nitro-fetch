import React from 'react';
import { View, Text, StyleSheet, ScrollView, Pressable } from 'react-native';
import { TextDecoder as NitroTextDecoder } from 'react-native-nitro-text-decoder';
import { theme } from '../theme';

declare const performance: any;

type Shape = 'ascii' | 'mixed' | '2byte' | '3byte' | '4byte' | 'bom+ascii';
type Size = 64 | 256 | 1024 | 4096 | 16384 | 65536;

type Row = {
  shape: Shape;
  size: Size;
  runsUs: number[]; // µs/decode per pass
  minUs: number;
  medUs: number;
  maxUs: number;
  medMBs: number;
};

const ITERATIONS = 2000;
const WARMUP = 200;
const PASSES = 10;
const BLOCK = 50;
const SHAPES: Shape[] = [
  'ascii',
  'mixed',
  '2byte',
  '3byte',
  '4byte',
  'bom+ascii',
];
const SIZES: Size[] = [64, 256, 1024, 4096, 16384, 65536];

const SHAPE_LABEL: Record<Shape, string> = {
  'ascii': 'ASCII',
  'mixed': 'Mixed (5%)',
  '2byte': '2-byte (Latin)',
  '3byte': '3-byte (CJK)',
  '4byte': '4-byte (emoji)',
  'bom+ascii': 'BOM + ASCII',
};

function makePayload(shape: Shape, size: Size): Uint8Array {
  const buf = new Uint8Array(size);
  let i = 0;
  if (shape === 'ascii') {
    while (i < size) buf[i++] = 0x20 + (i % 0x5e);
    return buf;
  }
  if (shape === 'bom+ascii') {
    if (size >= 3) {
      buf[0] = 0xef;
      buf[1] = 0xbb;
      buf[2] = 0xbf;
      i = 3;
    }
    while (i < size) buf[i++] = 0x20 + (i % 0x5e);
    return buf;
  }
  if (shape === 'mixed') {
    while (i < size) {
      if (i % 20 === 19 && i + 1 < size) {
        buf[i] = 0xc3;
        buf[i + 1] = 0xa9;
        i += 2;
      } else {
        buf[i] = 0x20 + (i % 0x5e);
        i++;
      }
    }
    return buf;
  }
  if (shape === '2byte') {
    while (i + 2 <= size) {
      buf[i] = 0xc3;
      buf[i + 1] = 0xa9;
      i += 2;
    }
    while (i < size) buf[i++] = 0x20;
    return buf;
  }
  if (shape === '3byte') {
    while (i + 3 <= size) {
      buf[i] = 0xe6;
      buf[i + 1] = 0x97;
      buf[i + 2] = 0xa5;
      i += 3;
    }
    while (i < size) buf[i++] = 0x20;
    return buf;
  }
  // 4-byte (emoji 😀 = F0 9F 98 80)
  while (i + 4 <= size) {
    buf[i] = 0xf0;
    buf[i + 1] = 0x9f;
    buf[i + 2] = 0x98;
    buf[i + 3] = 0x80;
    i += 4;
  }
  while (i < size) buf[i++] = 0x20;
  return buf;
}

function now(): number {
  return performance && performance.now ? performance.now() : Date.now();
}

function trimmedMean(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  const k = Math.floor(sorted.length * 0.1);
  const sliced = sorted.slice(k, sorted.length - k);
  let sum = 0;
  for (const v of sliced) sum += v;
  return sum / sliced.length;
}

function median(values: number[]): number {
  const s = values.slice().sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

function timeNitro(
  decoder: NitroTextDecoder,
  payload: Uint8Array,
  iterations: number
): number {
  const blocks = Math.max(1, Math.floor(iterations / BLOCK));
  const samples: number[] = [];
  let sink = 0;
  for (let b = 0; b < blocks; b++) {
    const t0 = now();
    for (let j = 0; j < BLOCK; j++) {
      const out = decoder.decode(payload);
      sink += out.length;
    }
    const t1 = now();
    samples.push(((t1 - t0) * 1000) / BLOCK); // µs per decode
  }
  if (sink < 0) console.log('unreachable');
  return trimmedMean(samples);
}

function sizeLabel(size: Size): string {
  if (size >= 1024) return `${size / 1024}KB`;
  return `${size}B`;
}

async function runBench(
  onProgress: (msg: string) => void
): Promise<{ rows: Row[]; totalMs: number }> {
  const rows: Row[] = [];
  const dec = new NitroTextDecoder();
  const tStart = now();

  console.log(
    `[TextDecoderBench] start · ${SHAPES.length} shapes × ${SIZES.length} sizes × ${PASSES} passes · ${ITERATIONS} iters/case`
  );
  console.log('[TextDecoderBench] CSV pass,shape,size,us,mbs');

  for (const shape of SHAPES) {
    for (const size of SIZES) {
      const payload = makePayload(shape, size);
      const runsUs: number[] = [];

      // Warm up once per (shape, size).
      for (let k = 0; k < WARMUP; k++) dec.decode(payload);
      await new Promise((r) => setTimeout(r, 0));

      for (let pass = 1; pass <= PASSES; pass++) {
        onProgress(
          `${SHAPE_LABEL[shape]} · ${sizeLabel(size)} · pass ${pass}/${PASSES}`
        );
        const us = timeNitro(dec, payload, ITERATIONS);
        runsUs.push(us);
        console.log(
          `[TextDecoderBench] CSV ${pass},${shape},${size},${us.toFixed(3)},${(size / us).toFixed(1)}`
        );
        await new Promise((r) => setTimeout(r, 0));
      }

      const minUs = Math.min(...runsUs);
      const maxUs = Math.max(...runsUs);
      const medUs = median(runsUs);
      rows.push({
        shape,
        size,
        runsUs,
        minUs,
        medUs,
        maxUs,
        medMBs: size / medUs,
      });
    }
  }

  const totalMs = now() - tStart;
  console.log(`[TextDecoderBench] done in ${(totalMs / 1000).toFixed(1)}s`);
  console.log(
    `[TextDecoderBench] SUMMARY shape,size,min_us,med_us,max_us,med_mbs`
  );
  for (const r of rows) {
    console.log(
      `[TextDecoderBench] SUMMARY ${r.shape},${r.size},${r.minUs.toFixed(3)},${r.medUs.toFixed(3)},${r.maxUs.toFixed(3)},${r.medMBs.toFixed(1)}`
    );
  }

  return { rows, totalMs };
}

export function TextDecoderBenchmarkScreen() {
  const [rows, setRows] = React.useState<Row[] | null>(null);
  const [totalMs, setTotalMs] = React.useState<number | null>(null);
  const [running, setRunning] = React.useState(false);
  const [progress, setProgress] = React.useState<string>('');

  const run = React.useCallback(async () => {
    if (running) return;
    setRunning(true);
    setRows(null);
    setTotalMs(null);
    setProgress('Warming up…');
    try {
      await new Promise((r) => setTimeout(r, 50));
      const { rows: out, totalMs: ms } = await runBench(setProgress);
      setRows(out);
      setTotalMs(ms);
      setProgress('');
    } finally {
      setRunning(false);
    }
  }, [running]);

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>TextDecoder Benchmark</Text>
        <Text style={styles.subtitle}>
          Nitro · {SHAPES.length}×{SIZES.length} cases · {PASSES} passes ·{' '}
          {ITERATIONS} iters
        </Text>
        <Text style={styles.subtitleSmall}>
          Results also logged to JS console as CSV.
        </Text>
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
        {rows == null ? (
          <View style={styles.loadingContainer}>
            <Text style={styles.loadingText}>
              {running
                ? `Running…\n${progress}`
                : 'Tap "Run Benchmark" to start. Expect ~30–60s.'}
            </Text>
          </View>
        ) : (
          <View style={styles.resultsCard}>
            <View style={styles.summaryBar}>
              <Text style={styles.summaryText}>
                Completed in{' '}
                <Text style={styles.summaryStrong}>
                  {totalMs != null ? (totalMs / 1000).toFixed(1) : '—'}s
                </Text>
                {' · '}
                {rows.length} cases × {PASSES} passes
              </Text>
            </View>

            <View style={styles.tableHeader}>
              <Text style={[styles.cell, styles.shapeCell, styles.headerText]}>
                Shape
              </Text>
              <Text style={[styles.cell, styles.sizeCell, styles.headerText]}>
                Size
              </Text>
              <Text style={[styles.cell, styles.numCell, styles.headerText]}>
                min µs
              </Text>
              <Text style={[styles.cell, styles.numCell, styles.headerText]}>
                med µs
              </Text>
              <Text style={[styles.cell, styles.numCell, styles.headerText]}>
                max µs
              </Text>
              <Text style={[styles.cell, styles.numCell, styles.headerText]}>
                MB/s
              </Text>
            </View>

            {rows.map((r) => (
              <View key={`${r.shape}-${r.size}`} style={styles.row}>
                <Text style={[styles.cell, styles.shapeCell]}>
                  {SHAPE_LABEL[r.shape]}
                </Text>
                <Text style={[styles.cell, styles.sizeCell]}>
                  {sizeLabel(r.size)}
                </Text>
                <Text style={[styles.cell, styles.numCell]}>
                  {r.minUs.toFixed(2)}
                </Text>
                <Text style={[styles.cell, styles.numCell, styles.medCell]}>
                  {r.medUs.toFixed(2)}
                </Text>
                <Text style={[styles.cell, styles.numCell]}>
                  {r.maxUs.toFixed(2)}
                </Text>
                <Text style={[styles.cell, styles.numCell, styles.mbCell]}>
                  {r.medMBs.toFixed(0)}
                </Text>
              </View>
            ))}

            <View style={styles.legend}>
              <Text style={styles.legendText}>
                Screenshot this table, switch builds (stash/pop the C++ patch),
                rebuild, run again.
              </Text>
              <Text style={styles.legendText}>
                Also check the JS console — the CSV log makes it trivial to diff
                the two runs in a spreadsheet.
              </Text>
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
  subtitleSmall: {
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginTop: 2,
    fontStyle: 'italic',
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
    paddingBottom: 40,
  },
  loadingContainer: {
    padding: theme.spacing.xl,
    alignItems: 'center',
  },
  loadingText: {
    color: theme.colors.textSecondary,
    fontSize: 14,
    textAlign: 'center',
  },
  resultsCard: {
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.lg,
    overflow: 'hidden',
  },
  summaryBar: {
    padding: theme.spacing.md,
    backgroundColor: '#FAFAFC',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  summaryText: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  summaryStrong: {
    fontWeight: '700',
    color: theme.colors.text,
  },
  tableHeader: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 6,
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
    paddingHorizontal: 6,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#F0F0F0',
  },
  cell: {
    fontSize: 12,
    color: theme.colors.text,
  },
  shapeCell: {
    flex: 2,
    color: theme.colors.textSecondary,
  },
  sizeCell: {
    flex: 1,
    color: theme.colors.textSecondary,
  },
  numCell: {
    flex: 1.2,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  medCell: {
    fontWeight: '700',
    color: theme.colors.text,
  },
  mbCell: {
    color: theme.colors.primary,
    fontWeight: '600',
  },
  legend: {
    padding: theme.spacing.md,
    backgroundColor: '#FAFAFC',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: theme.colors.border,
  },
  legendText: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    marginBottom: 4,
  },
});
