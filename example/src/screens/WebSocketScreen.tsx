import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Pressable,
  ScrollView,
  TextInput,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import {
  NitroWebSocket,
  type WebSocketMessageEvent,
  type WebSocketCloseEvent,
} from 'react-native-nitro-websockets';
import { theme } from '../theme';

type LogEntry = { time: string; direction: 'in' | 'out' | 'sys'; text: string };

const ECHO_URL = 'wss://echo.websocket.org';

// Module-level: survives navigation (component unmount/remount).
// The socket keeps the C++ object alive even when the screen is not visible.
let _ws: NitroWebSocket | null = null;

function timestamp() {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function WebSocketScreen() {
  // Derive initial state from the live socket so navigation back shows the
  // correct status without re-connecting.
  const [connected, setConnected] = React.useState(
    () => _ws?.readyState === 'OPEN'
  );
  const [connecting, setConnecting] = React.useState(
    () => _ws?.readyState === 'CONNECTING'
  );
  const [logs, setLogs] = React.useState<LogEntry[]>([]);
  const [input, setInput] = React.useState('Hello, WebSocket!');
  const scrollRef = React.useRef<ScrollView>(null);

  // Re-attach callbacks whenever the screen mounts so state updates reach
  // this component instance (e.g. after navigating away and back).
  React.useEffect(() => {
    if (!_ws) return;
    _ws.onopen = () => {
      setConnected(true);
      setConnecting(false);
      addLog('sys', 'Connected');
    };
    _ws.onmessage = (evt: WebSocketMessageEvent) => addLog('in', evt.data);
    _ws.onerror = (err: string) => {
      addLog('sys', `Error: ${err}`);
      setConnected(false);
      setConnecting(false);
      _ws = null;
    };
    _ws.onclose = (evt: WebSocketCloseEvent) => {
      addLog(
        'sys',
        `Closed (code ${evt.code}${evt.reason ? ` — ${evt.reason}` : ''})`
      );
      setConnected(false);
      setConnecting(false);
      _ws = null;
    };
  }, []);

  const addLog = (direction: LogEntry['direction'], text: string) => {
    setLogs((prev) => [...prev, { time: timestamp(), direction, text }]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
  };

  const connect = () => {
    if (_ws) return;
    setConnecting(true);
    addLog('sys', `Connecting to ${ECHO_URL}…`);

    const ws = new NitroWebSocket(ECHO_URL);
    _ws = ws;

    ws.onopen = () => {
      setConnected(true);
      setConnecting(false);
      addLog('sys', 'Connected');
    };

    ws.onmessage = (evt: WebSocketMessageEvent) => {
      addLog('in', evt.data);
    };

    ws.onerror = (err: string) => {
      addLog('sys', `Error: ${err}`);
      console.error('Error: ', err);
      setConnected(false);
      setConnecting(false);
      _ws = null;
    };

    ws.onclose = (evt: WebSocketCloseEvent) => {
      addLog(
        'sys',
        `Closed (code ${evt.code}${evt.reason ? ` — ${evt.reason}` : ''})`
      );
      setConnected(false);
      setConnecting(false);
      _ws = null;
    };
  };

  const disconnect = () => {
    _ws?.close(1000, 'user closed');
  };

  const sendMessage = () => {
    const msg = input.trim();
    if (!msg || !connected) return;
    _ws?.send(msg);
    addLog('out', msg);
  };

  const clearLogs = () => setLogs([]);

  const logColor = (dir: LogEntry['direction']) => {
    if (dir === 'in') return '#4EC9B0';
    if (dir === 'out') return '#CE9178';
    return '#858585';
  };

  const logPrefix = (dir: LogEntry['direction']) => {
    if (dir === 'in') return '← ';
    if (dir === 'out') return '→ ';
    return '  ';
  };

  const statusColor = connected
    ? theme.colors.success
    : connecting
      ? theme.colors.primary
      : theme.colors.textSecondary;

  const statusText = connected
    ? 'Connected'
    : connecting
      ? 'Connecting…'
      : 'Disconnected';

  return (
    <View style={styles.container}>
      {/* Status bar */}
      <View style={styles.statusRow}>
        <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
        <Text style={[styles.statusText, { color: statusColor }]}>
          {statusText}
        </Text>
        {!connected && !connecting ? (
          <Pressable style={styles.actionBtn} onPress={connect}>
            <Text style={styles.actionBtnText}>Connect</Text>
          </Pressable>
        ) : connected ? (
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnDanger]}
            onPress={disconnect}
          >
            <Text style={[styles.actionBtnText, styles.actionBtnDangerText]}>
              Disconnect
            </Text>
          </TouchableOpacity>
        ) : (
          <ActivityIndicator size="small" color={theme.colors.primary} />
        )}
      </View>

      {/* Log console */}
      <View style={styles.console}>
        <View style={styles.consoleHeader}>
          <Text style={styles.consoleTitle}>Messages</Text>
          <Pressable onPress={clearLogs}>
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        </View>
        <ScrollView
          ref={scrollRef}
          style={styles.consoleBody}
          contentContainerStyle={styles.consoleContent}
        >
          {logs.length === 0 ? (
            <Text style={styles.emptyText}>
              Connect to start sending messages…
            </Text>
          ) : (
            logs.map((entry, i) => (
              <Text
                key={i}
                style={[styles.logLine, { color: logColor(entry.direction) }]}
              >
                <Text style={styles.logTime}>{entry.time} </Text>
                {logPrefix(entry.direction)}
                {entry.text}
              </Text>
            ))
          )}
        </ScrollView>
      </View>

      {/* Input row */}
      <View style={styles.inputRow}>
        <TextInput
          style={styles.textInput}
          value={input}
          onChangeText={setInput}
          placeholder="Type a message…"
          placeholderTextColor="#555"
          editable={connected}
          onSubmitEditing={sendMessage}
          returnKeyType="send"
        />
        <Pressable
          style={[styles.sendBtn, !connected && styles.sendBtnDisabled]}
          onPress={sendMessage}
          disabled={!connected}
        >
          <Text style={styles.sendBtnText}>Send</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.md,
    gap: theme.spacing.md,
  },
  statusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.colors.card,
    borderRadius: theme.borderRadius.md,
    padding: theme.spacing.md,
    gap: theme.spacing.sm,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 4,
    elevation: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  statusText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
  },
  actionBtn: {
    backgroundColor: theme.colors.primary,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.xs + 2,
    borderRadius: theme.borderRadius.sm,
  },
  actionBtnDanger: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: theme.colors.error,
  },
  actionBtnText: {
    color: '#FFF',
    fontSize: 13,
    fontWeight: '600',
  },
  actionBtnDangerText: {
    color: theme.colors.error,
  },
  console: {
    flex: 1,
    backgroundColor: '#1E1E1E',
    borderRadius: theme.borderRadius.md,
    overflow: 'hidden',
  },
  consoleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#141414',
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
  },
  consoleTitle: {
    color: '#CCC',
    fontSize: 12,
    fontWeight: '600',
  },
  clearText: {
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  consoleBody: {
    flex: 1,
  },
  consoleContent: {
    padding: theme.spacing.md,
    gap: 4,
  },
  emptyText: {
    color: '#555',
    fontFamily: 'monospace',
    fontSize: 13,
    textAlign: 'center',
    marginTop: theme.spacing.xl,
  },
  logLine: {
    fontFamily: 'monospace',
    fontSize: 12,
    lineHeight: 18,
  },
  logTime: {
    color: '#555',
  },
  inputRow: {
    flexDirection: 'row',
    gap: theme.spacing.sm,
  },
  textInput: {
    flex: 1,
    backgroundColor: '#1E1E1E',
    color: '#E0E0E0',
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    paddingVertical: theme.spacing.sm,
    fontFamily: 'monospace',
    fontSize: 14,
  },
  sendBtn: {
    backgroundColor: theme.colors.primary,
    borderRadius: theme.borderRadius.md,
    paddingHorizontal: theme.spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.4,
  },
  sendBtnText: {
    color: '#FFF',
    fontSize: 14,
    fontWeight: '600',
  },
});
