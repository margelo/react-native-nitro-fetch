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
import type {
  NetworkEntry,
  WebSocketEntry,
  InspectorEntry,
} from 'react-native-nitro-fetch';
import { NitroWebSocket } from 'react-native-nitro-websockets';
import { theme } from '../theme';

type FilterMode = 'all' | 'http' | 'websocket';

export function NetworkInspectorScreen() {
  const [entries, setEntries] = React.useState<readonly InspectorEntry[]>([]);
  const [enabled, setEnabled] = React.useState(NetworkInspector.isEnabled());
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [logs, setLogs] = React.useState<string[]>([]);
  const [filter, setFilter] = React.useState<FilterMode>('all');

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

  const runTestWebSocket = () => {
    addLog('Opening WebSocket to echo.websocket.events...');
    const ws = new NitroWebSocket('wss://echo.websocket.events');
    ws.onopen = () => {
      addLog('WS connected, sending message...');
      ws.send('Hello from Inspector!');
    };
    ws.onmessage = (e) => {
      addLog(`WS received: ${e.data.slice(0, 80)}`);
      // Close after receiving echo (skip the server greeting)
      if (e.data.includes('Hello from Inspector')) {
        ws.close(1000, 'done');
      }
    };
    ws.onclose = (e) => {
      addLog(`WS closed: code=${e.code} reason=${e.reason}`);
      setEntries([...NetworkInspector.getEntries()]);
    };
    ws.onerror = (error) => {
      addLog(`WS error: ${error}`);
      setEntries([...NetworkInspector.getEntries()]);
    };
  };

  const clearAll = () => {
    NetworkInspector.clear();
    setEntries([]);
    setSelectedId(null);
    setLogs([]);
  };

  const filteredEntries = entries.filter((e) => {
    if (filter === 'all') return true;
    return e.type === filter;
  });

  const selected = selectedId ? entries.find((e) => e.id === selectedId) : null;

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
          style={[
            styles.btn,
            styles.btnPrimary,
            !enabled && styles.btnDisabled,
          ]}
          onPress={enabled ? runSampleRequests : undefined}
        >
          <Text style={styles.btnText}>Run Requests</Text>
        </Pressable>
        <Pressable style={[styles.btn, styles.btnSecondary]} onPress={clearAll}>
          <Text style={styles.btnTextSecondary}>Clear</Text>
        </Pressable>
      </View>

      {/* Second row: curl gen + test ws */}
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
        <Pressable
          style={[
            styles.btn,
            styles.btnPrimary,
            !enabled && styles.btnDisabled,
          ]}
          onPress={enabled ? runTestWebSocket : undefined}
        >
          <Text style={styles.btnText}>Test WebSocket</Text>
        </Pressable>
      </View>

      {/* Filter tabs */}
      <View style={styles.filterRow}>
        {(['all', 'http', 'websocket'] as FilterMode[]).map((mode) => (
          <Pressable
            key={mode}
            style={[
              styles.filterTab,
              filter === mode && styles.filterTabActive,
            ]}
            onPress={() => setFilter(mode)}
          >
            <Text
              style={[
                styles.filterTabText,
                filter === mode && styles.filterTabTextActive,
              ]}
            >
              {mode === 'all' ? 'All' : mode === 'http' ? 'HTTP' : 'WS'}
            </Text>
          </Pressable>
        ))}
      </View>

      {/* Entry list or detail */}
      {selected ? (
        selected.type === 'websocket' ? (
          <WsDetailView entry={selected} onBack={() => setSelectedId(null)} />
        ) : (
          <HttpDetailView
            entry={selected}
            onBack={() => setSelectedId(null)}
            onShareCurl={shareCurl}
          />
        )
      ) : (
        <ScrollView style={styles.entryList}>
          {filteredEntries.length === 0 && (
            <Text style={styles.emptyText}>
              {enabled
                ? 'No requests captured yet. Tap "Run Requests" or "Test WebSocket".'
                : 'Enable the inspector to start capturing.'}
            </Text>
          )}
          {filteredEntries.map((entry) =>
            entry.type === 'websocket' ? (
              <Pressable
                key={entry.id}
                style={styles.entryRow}
                onPress={() => setSelectedId(entry.id)}
              >
                <View style={styles.entryLeft}>
                  <Text style={styles.entryMethodWs}>WS</Text>
                  <Text style={styles.entryUrl} numberOfLines={1}>
                    {entry.url.replace(/^wss?:\/\//, '')}
                  </Text>
                </View>
                <View style={styles.entryRight}>
                  <Text style={styles.wsMessageCount}>
                    {entry.messagesSent + entry.messagesReceived} msgs
                  </Text>
                  <Text style={styles.entryDuration}>
                    {entry.duration > 0
                      ? `${entry.duration.toFixed(0)}ms`
                      : entry.readyState}
                  </Text>
                </View>
              </Pressable>
            ) : (
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
            )
          )}
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

function HttpDetailView({
  entry,
  onBack,
  onShareCurl,
}: {
  entry: NetworkEntry;
  onBack: () => void;
  onShareCurl: (curl: string) => Promise<void>;
}) {
  return (
    <View style={styles.detailContainer}>
      <Pressable onPress={onBack}>
        <Text style={styles.backBtn}>Back to list</Text>
      </Pressable>
      <ScrollView style={styles.detailScroll}>
        <Text style={styles.detailTitle}>
          {entry.method} {entry.url}
        </Text>
        <DetailRow
          label="Status"
          value={`${entry.status} ${entry.statusText}`}
        />
        <DetailRow label="Duration" value={`${entry.duration.toFixed(1)} ms`} />
        <DetailRow
          label="Request Body Size"
          value={`${entry.requestBodySize} bytes`}
        />
        <DetailRow
          label="Response Body Size"
          value={`${entry.responseBodySize} bytes`}
        />
        {entry.error && <DetailRow label="Error" value={entry.error} isError />}

        <Text style={styles.sectionTitle}>Request Headers</Text>
        {entry.requestHeaders.map((h, i) => (
          <Text key={i} style={styles.headerLine}>
            {h.key}: {h.value}
          </Text>
        ))}

        <Text style={styles.sectionTitle}>Response Headers</Text>
        {entry.responseHeaders.map((h, i) => (
          <Text key={i} style={styles.headerLine}>
            {h.key}: {h.value}
          </Text>
        ))}

        {entry.requestBody ? (
          <>
            <Text style={styles.sectionTitle}>Request Body</Text>
            <Text style={styles.bodyText}>{entry.requestBody}</Text>
          </>
        ) : null}

        {entry.responseBody ? (
          <>
            <Text style={styles.sectionTitle}>Response Body</Text>
            <ScrollView style={styles.responseBodyScroll} nestedScrollEnabled>
              <Text style={styles.bodyText}>{entry.responseBody}</Text>
            </ScrollView>
          </>
        ) : null}

        <Text style={styles.sectionTitle}>Curl Command</Text>
        <Pressable onPress={() => onShareCurl(entry.curl)}>
          <Text style={styles.curlText}>{entry.curl}</Text>
          <Text style={styles.tapHint}>Tap to share</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

function WsDetailView({
  entry,
  onBack,
}: {
  entry: WebSocketEntry;
  onBack: () => void;
}) {
  return (
    <View style={styles.detailContainer}>
      <Pressable onPress={onBack}>
        <Text style={styles.backBtn}>Back to list</Text>
      </Pressable>
      <ScrollView style={styles.detailScroll}>
        <Text style={styles.detailTitle}>WS {entry.url}</Text>
        <DetailRow label="State" value={entry.readyState} />
        <DetailRow
          label="Duration"
          value={entry.duration > 0 ? `${entry.duration.toFixed(1)} ms` : '-'}
        />
        <DetailRow
          label="Protocols"
          value={entry.protocols.join(', ') || '-'}
        />
        <DetailRow
          label="Sent"
          value={`${entry.messagesSent} msgs (${entry.bytesSent} B)`}
        />
        <DetailRow
          label="Received"
          value={`${entry.messagesReceived} msgs (${entry.bytesReceived} B)`}
        />
        {entry.closeCode != null && (
          <DetailRow label="Close Code" value={String(entry.closeCode)} />
        )}
        {entry.closeReason ? (
          <DetailRow label="Close Reason" value={entry.closeReason} />
        ) : null}
        {entry.error && <DetailRow label="Error" value={entry.error} isError />}

        {entry.requestHeaders.length > 0 && (
          <>
            <Text style={styles.sectionTitle}>Headers</Text>
            {entry.requestHeaders.map((h, i) => (
              <Text key={i} style={styles.headerLine}>
                {h.key}: {h.value}
              </Text>
            ))}
          </>
        )}

        <Text style={styles.sectionTitle}>
          Messages ({entry.messages.length})
        </Text>
        {entry.messages.length === 0 && (
          <Text style={styles.emptyText}>No messages yet</Text>
        )}
        {entry.messages.map((msg, i) => (
          <View key={i} style={styles.wsMessageRow}>
            <Text
              style={[
                styles.wsDirection,
                msg.direction === 'sent'
                  ? styles.wsDirectionSent
                  : styles.wsDirectionReceived,
              ]}
            >
              {msg.direction === 'sent' ? '\u2191' : '\u2193'}
            </Text>
            <View style={styles.wsMessageContent}>
              <Text style={styles.wsMessageData} numberOfLines={3}>
                {msg.isBinary ? `[binary ${msg.size}B]` : msg.data}
              </Text>
              <Text style={styles.wsMessageMeta}>{msg.size}B</Text>
            </View>
          </View>
        ))}
      </ScrollView>
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
      <Text style={[styles.detailValue, isError && styles.errorText]}>
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

  // Filter tabs
  filterRow: {
    flexDirection: 'row',
    gap: 4,
    marginBottom: theme.spacing.sm,
  },
  filterTab: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: theme.borderRadius.sm,
    backgroundColor: theme.colors.card,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  filterTabActive: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  filterTabText: {
    fontSize: 12,
    fontWeight: '600',
    color: theme.colors.textSecondary,
  },
  filterTabTextActive: {
    color: '#FFF',
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
  entryMethodWs: {
    fontWeight: '700',
    fontSize: 12,
    color: '#FF9500',
    width: 40,
  },
  entryUrl: { fontSize: 13, color: theme.colors.text, flex: 1 },
  entryRight: { alignItems: 'flex-end', marginLeft: 8 },
  entryStatus: { fontWeight: '700', fontSize: 13 },
  statusOk: { color: theme.colors.success },
  statusErr: { color: theme.colors.error },
  errorText: { color: '#FF3B30' },
  entryDuration: { fontSize: 11, color: theme.colors.textSecondary },
  wsMessageCount: { fontWeight: '600', fontSize: 12, color: '#FF9500' },

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
  responseBodyScroll: {
    maxHeight: 200,
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

  // WebSocket messages
  wsMessageRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    paddingVertical: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: theme.colors.border,
  },
  wsDirection: {
    fontSize: 16,
    fontWeight: '700',
    width: 24,
    textAlign: 'center',
  },
  wsDirectionSent: { color: theme.colors.primary },
  wsDirectionReceived: { color: theme.colors.success },
  wsMessageContent: { flex: 1 },
  wsMessageData: {
    fontFamily: 'monospace',
    fontSize: 11,
    color: theme.colors.text,
  },
  wsMessageMeta: {
    fontSize: 10,
    color: theme.colors.textSecondary,
    marginTop: 2,
  },

  // Console
  consoleWrapper: {
    height: 300,
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
