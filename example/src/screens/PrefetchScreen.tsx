import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import {
  fetch as nitroFetch,
  prefetch,
  prefetchOnAppStart,
  removeAllFromAutoprefetch,
} from 'react-native-nitro-fetch';
import { theme } from '../theme';

declare const performance: any;

const PREFETCH_URL = 'https://httpbin.org/uuid';
const PREFETCH_KEY = 'uuid';

export function PrefetchScreen() {
  const [logs, setLogs] = React.useState<string[]>([]);

  const addLog = (msg: string) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
  };

  const handlePrefetch = async () => {
    try {
      addLog('Starting prefetch...');
      await prefetch(PREFETCH_URL, {
        headers: { prefetchKey: PREFETCH_KEY },
      });
      addLog('✅ Prefetch request dispatched natively');
    } catch (e: any) {
      addLog(`❌ Prefetch error: ${e?.message ?? String(e)}`);
    }
  };

  const handleFetchPrefetched = async () => {
    try {
      addLog('Fetching from prefetched cache...');
      const t0 = performance.now();
      const res = await nitroFetch(PREFETCH_URL, {
        headers: { prefetchKey: PREFETCH_KEY },
      });
      const text = await res.text();
      const prefHeader = res.headers.get('nitroPrefetched');
      const time = (performance.now() - t0).toFixed(0);

      addLog(
        `✅ Fetched in ${time}ms\nnitroPrefetched: ${prefHeader ?? 'null'}\nResponse: ${text.substring(0, 50)}...`
      );
    } catch (e: any) {
      addLog(`❌ Fetch error: ${e?.message ?? String(e)}`);
    }
  };

  const handleSchedulePrefetch = async () => {
    try {
      addLog('Scheduling on app start...');
      await prefetchOnAppStart(PREFETCH_URL, {
        prefetchKey: PREFETCH_KEY,
      });
      addLog('✅ Scheduled successfully in NativeStorage');
    } catch (e: any) {
      addLog(`❌ Schedule error: ${e?.message ?? String(e)}`);
    }
  };

  const handleClearPrefetch = async () => {
    try {
      addLog('Clearing auto-prefetch queue...');
      await removeAllFromAutoprefetch();
      addLog('✅ Cleared auto-prefetch queue');
    } catch (e: any) {
      addLog(`❌ Clear error: ${e?.message ?? String(e)}`);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.actions}>
        <View style={styles.row}>
          <Pressable style={styles.button} onPress={handlePrefetch}>
            <Text style={styles.buttonText}>Prefetch Now</Text>
            <Text style={styles.buttonSub}>Sends request in bg</Text>
          </Pressable>
          <Pressable
            style={[styles.button, styles.primaryBtn]}
            onPress={handleFetchPrefetched}
          >
            <Text style={[styles.buttonText, styles.primaryBtnText]}>
              Consume Fetch
            </Text>
            <Text style={[styles.buttonSub, styles.primaryBtnSub]}>
              Reads prefetched data
            </Text>
          </Pressable>
        </View>

        <View style={styles.row}>
          <Pressable style={styles.button} onPress={handleSchedulePrefetch}>
            <Text style={styles.buttonText}>Schedule Boot</Text>
            <Text style={styles.buttonSub}>Save to NativeStorage</Text>
          </Pressable>
          <Pressable
            style={[styles.button, styles.dangerBtn]}
            onPress={handleClearPrefetch}
          >
            <Text style={styles.buttonText}>Clear Schedule</Text>
            <Text style={styles.buttonSub}>Removes all saved tasks</Text>
          </Pressable>
        </View>
      </View>

      <View style={styles.logContainer}>
        <Text style={styles.logTitle}>Execution Logs</Text>
        <ScrollView style={styles.logScroll}>
          {logs.map((L, i) => (
            <Text key={i} style={styles.logText}>
              {L}
            </Text>
          ))}
          {logs.length === 0 && (
            <Text style={styles.emptyLog}>
              Press buttons above to test prefetching
            </Text>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: theme.colors.background,
    padding: theme.spacing.md,
  },
  actions: {
    gap: theme.spacing.md,
    marginBottom: theme.spacing.lg,
  },
  row: {
    flexDirection: 'row',
    gap: theme.spacing.md,
  },
  button: {
    flex: 1,
    backgroundColor: theme.colors.card,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    alignItems: 'center',
  },
  primaryBtn: {
    backgroundColor: theme.colors.primary,
    borderColor: theme.colors.primary,
  },
  primaryBtnText: {
    color: '#FFF',
  },
  primaryBtnSub: {
    color: 'rgba(255,255,255,0.8)',
  },
  dangerBtn: {
    borderColor: theme.colors.error,
    backgroundColor: '#FFF0F0',
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
    color: theme.colors.text,
    marginBottom: 4,
  },
  buttonSub: {
    fontSize: 12,
    color: theme.colors.textSecondary,
    textAlign: 'center',
  },
  logContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    overflow: 'hidden',
  },
  logTitle: {
    padding: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: '#F8F8F8',
    color: theme.colors.textSecondary,
    fontWeight: '600',
    fontSize: 12,
    textTransform: 'uppercase',
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  logScroll: {
    padding: theme.spacing.md,
  },
  logText: {
    fontFamily: 'monospace',
    fontSize: 13,
    color: '#333',
    marginBottom: theme.spacing.md,
    lineHeight: 18,
  },
  emptyLog: {
    color: theme.colors.textSecondary,
    textAlign: 'center',
    marginTop: theme.spacing.xl,
  },
});
