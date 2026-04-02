import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  Share,
} from 'react-native';
import {
  fetch as nitroFetch,
  NetworkInspector,
  generateCurl,
} from 'react-native-nitro-fetch';
import type { NetworkEntry } from 'react-native-nitro-fetch';
import { theme } from '../theme';

export function NetworkInspectorScreen() {
  const [entries, setEntries] = React.useState<readonly NetworkEntry[]>([]);
  const [enabled, setEnabled] = React.useState(NetworkInspector.isEnabled());
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [logs, setLogs] = React.useState<string[]>([]);

  const addLog = (msg: string) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
  };

  // Live listener
  React.useEffect(() => {
    const unsub = NetworkInspector.onEntry((_entry) => {
      setEntries([...NetworkInspector.getEntries()]);
    });
    return unsub;
  }, []);

  const toggleInspector = () => {
    if (enabled) {
      NetworkInspector.disable();
      setEnabled(false);
      addLog('Inspector disabled');
    } else {
      NetworkInspector.enable();
      setEnabled(true);
      addLog('Inspector enabled - make some requests!');
    }
  };

  const runSampleRequests = async () => {
    addLog('Running sample requests...');
    try {
      await nitroFetch('https://httpbin.org/get');
      addLog('GET /get done');
    } catch (e: any) {
      addLog(`GET /get failed: ${e.message}`);
    }
    try {
      await nitroFetch('https://httpbin.org/post', {
        method: 'POST',
        body: JSON.stringify({ hello: 'world', ts: Date.now() }),
        headers: { 'Content-Type': 'application/json' },
      });
      addLog('POST /post done');
    } catch (e: any) {
      addLog(`POST /post failed: ${e.message}`);
    }
    try {
      await nitroFetch('https://httpbin.org/delay/1');
      addLog('GET /delay/1 done');
    } catch (e: any) {
      addLog(`GET /delay/1 failed: ${e.message}`);
    }
    setEntries([...NetworkInspector.getEntries()]);
    addLog(`Total entries: ${NetworkInspector.getEntries().length}`);
  };

  const clearAll = () => {
    NetworkInspector.clear();
    setEntries([]);
    setSelectedId(null);
    setLogs([]);
  };

  const selected = selectedId
    ? entries.find((e) => e.id === selectedId)
    : null;

  const shareCurl = async (curl: string) => {
    try {
      await Share.share({ message: curl });
    } catch {}
  };

  return (
    <View style={styles.container}>
      {/* Controls */}
      <View style={styles.controls}>
        <Pressable
          style={[styles.btn, enabled ? styles.btnDanger : styles.btnPrimary]}
          onPress={toggleInspector}
        >
          <Text style={styles.btnText}>
            {enabled ? 'Disable' : 'Enable'} Inspector
          </Text>
        </Pressable>
        <Pressable
          style={[styles.btn, styles.btnPrimary, !enabled && styles.btnDisabled]}
          onPress={enabled ? runSampleRequests : undefined}
        >
          <Text style={styles.btnText}>Run Requests</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.btnSecondary]} onPress={clearAll}>
          <Text style={styles.btnTextSecondary}>Clear</Text>
        </Pressable>
      </View>

      {/* Curl Generator standalone demo */}
      <View style={styles.controls}>
        <Pressable
          style={[styles.btn, styles.btnSecondary]}
          onPress={() => {
            const curl = generateCurl({
              url: 'https://api.example.com/data',
              method: 'POST',
              headers: [
                { key: 'Content-Type', value: 'application/json' },
                { key: 'Authorization', value: 'Bearer token123' },
              ],
              body: '{"key":"value"}',
            });
            addLog(`Curl: ${curl}`);
          }}
        >
          <Text style={styles.btnTextSecondary}>Gen Sample Curl</Text>
        </Pressable>
      </View>

      {/* Entry list or detail */}
      {selected ? (
        <View style={styles.detailContainer}>
          <Pressable onPress={() => setSelectedId(null)}>
            <Text style={styles.backBtn}>Back to list</Text>
          </Pressable>
          <ScrollView style={styles.detailScroll}>
            <Text style={styles.detailTitle}>
              {selected.method} {selected.url}
            </Text>
            <DetailRow label="Status" value={`${selected.status} ${selected.statusText}`} />
            <DetailRow label="Duration" value={`${selected.duration.toFixed(1)} ms`} />
            <DetailRow label="Request Body Size" value={`${selected.requestBodySize} bytes`} />
            <DetailRow label="Response Body Size" value={`${selected.responseBodySize} bytes`} />
            {selected.error && (
              <DetailRow label="Error" value={selected.error} isError />
            )}

            <Text style={styles.sectionTitle}>Request Headers</Text>
            {selected.requestHeaders.map((h, i) => (
              <Text key={i} style={styles.headerLine}>
                {h.key}: {h.value}
              </Text>
            ))}

            <Text style={styles.sectionTitle}>Response Headers</Text>
            {selected.responseHeaders.map((h, i) => (
              <Text key={i} style={styles.headerLine}>
                {h.key}: {h.value}
              </Text>
            ))}

            {selected.requestBody ? (
              <>
                <Text style={styles.sectionTitle}>Request Body</Text>
                <Text style={styles.bodyText}>{selected.requestBody}</Text>
              </>
            ) : null}

            <Text style={styles.sectionTitle}>Curl Command</Text>
            <Pressable onPress={() => shareCurl(selected.curl)}>
              <Text style={styles.curlText}>{selected.curl}</Text>
              <Text style={styles.tapHint}>Tap to share</Text>
            </Pressable>
          </ScrollView>
        </View>
      ) : (
        <ScrollView style={styles.entryList}>
          {entries.length === 0 && (
            <Text style={styles.emptyText}>
              {enabled
                ? 'No requests captured yet. Tap "Run Requests".'
                : 'Enable the inspector to start capturing.'}
            </Text>
          )}
          {entries.map((entry) => (
            <Pressable
              key={entry.id}
              style={styles.entryRow}
              onPress={() => setSelectedId(entry.id)}
            >
              <View style={styles.entryLeft}>
                <Text style={styles.entryMethod}>{entry.method}</Text>
                <Text style={styles.entryUrl} numberOfLines={1}>
                  {entry.url.replace(/^https?:\/\//, '')}
                </Text>
              </View>
              <View style={styles.entryRight}>
                <Text
                  style={[
                    styles.entryStatus,
                    entry.status >= 200 && entry.status < 300
                      ? styles.statusOk
                      : styles.statusErr,
                  ]}
                >
                  {entry.status || 'ERR'}
                </Text>
                <Text style={styles.entryDuration}>
                  {entry.duration.toFixed(0)}ms
                </Text>
              </View>
            </Pressable>
          ))}
        </ScrollView>
      )}

      {/* Log console */}
      <View style={styles.consoleWrapper}>
        <View style={styles.consoleHeader}>
          <Text style={styles.consoleTitle}>Log</Text>
        </View>
        <ScrollView style={styles.consoleArea}>
          {logs.map((log, i) => (
            <Text key={i} style={styles.logLine}>
              {log}
            </Text>
          ))}
        </ScrollView>
      </View>
    </View>
  );
}

function DetailRow({
  label,
  value,
  isError,
}: {
  label: string;
  value: string;
  isError?: boolean;
}) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={[styles.detailValue, isError && { color: '#FF3B30' }]}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.md,
  },
  controls: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
    marginBottom: theme.spacing.sm,
  },
  btn: {
    flex: 1,
    paddingVertical: 10,
    borderRadius: theme.borderRadius.sm,
    alignItems: 'center',
  },
  btnPrimary: { backgroundColor: theme.colors.primary },
  btnDanger: { backgroundColor: theme.colors.error },
  btnSecondary: {
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  btnDisabled: { opacity: 0.4 },
  btnText: { color: '#FFF', fontWeight: '600', fontSize: 13 },
  btnTextSecondary: {
    color: theme.colors.text,
    fontWeight: '600',
    fontSize: 13,
  },

  // Entry list
  entryList: { flex: 1, marginBottom: theme.spacing.sm },
  emptyText: {
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: theme.spacing.xl,
    fontSize: 14,
  },
  entryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    padding: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    borderRadius: theme.borderRadius.sm,
    marginBottom: 4,
  },
  entryLeft: { flexDirection: 'row', flex: 1, alignItems: 'center', gap: 8 },
  entryMethod: {
    fontWeight: '700',
    fontSize: 12,
    color: theme.colors.primary,
    width: 40,
  },
  entryUrl: { fontSize: 13, color: theme.colors.text, flex: 1 },
  entryRight: { alignItems: 'flex-end', marginLeft: 8 },
  entryStatus: { fontWeight: '700', fontSize: 13 },
  statusOk: { color: theme.colors.success },
  statusErr: { color: theme.colors.error },
  entryDuration: { fontSize: 11, color: theme.colors.textSecondary },

  // Detail view
  detailContainer: { flex: 1, marginBottom: theme.spacing.sm },
  backBtn: {
    color: theme.colors.primary,
    fontWeight: '600',
    marginBottom: theme.spacing.sm,
  },
  detailScroll: {
    flex: 1,
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
  },
  detailTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: theme.spacing.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  detailLabel: { fontSize: 13, color: theme.colors.textSecondary },
  detailValue: { fontSize: 13, fontWeight: '600', color: theme.colors.text },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: theme.colors.text,
    marginTop: theme.spacing.md,
    marginBottom: 4,
  },
  headerLine: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: theme.colors.textSecondary,
    marginBottom: 2,
  },
  bodyText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: theme.colors.text,
    backgroundColor: '#F5F5F5',
    padding: 8,
    borderRadius: 4,
  },
  curlText: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: theme.colors.primary,
    backgroundColor: '#F0F4FF',
    padding: 8,
    borderRadius: 4,
  },
  tapHint: {
    fontSize: 10,
    color: theme.colors.textSecondary,
    marginTop: 2,
    textAlign: 'right',
  },

  // Console
  consoleWrapper: {
    height: 400,
    backgroundColor: '#2B2B2B',
    borderRadius: theme.borderRadius.md,
    overflow: 'hidden',
  },
  consoleHeader: {
    padding: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: '#1E1E1E',
  },
  consoleTitle: { color: '#CCC', fontSize: 12, fontWeight: '600' },
  consoleArea: { padding: theme.spacing.sm },
  logLine: {
    color: '#FFF',
    fontFamily: 'monospace',
    fontSize: 11,
    marginBottom: 4,
  },
});
