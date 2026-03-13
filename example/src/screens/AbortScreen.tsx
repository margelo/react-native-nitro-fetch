import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import { fetch as nitroFetch } from 'react-native-nitro-fetch';
import { theme } from '../theme';
declare const performance: any;

export function AbortScreen() {
  const [logs, setLogs] = React.useState<string[]>([]);

  const addLog = (msg: string) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
  };

  const handleImmediateAbort = async () => {
    addLog('Starting request, aborting IMMEDIATELY...');
    const controller = new AbortController();
    controller.abort();
    try {
      await nitroFetch('https://httpbin.org/delay/20', {
        signal: controller.signal,
      });
      addLog('❌ ERROR: Request should have been aborted!');
    } catch (e: any) {
      addLog(
        `✅ Aborted as expected: ${e?.name ?? 'Error'} - ${e?.message ?? String(e)}`
      );
    }
  };

  const handleDelayedAbort = async () => {
    addLog('Starting request, aborting in 100ms...');
    const controller = new AbortController();
    setTimeout(() => controller.abort(), 100);
    const t0 = performance.now();
    try {
      await nitroFetch('https://httpbin.org/delay/20', {
        signal: controller.signal,
      });
      addLog('❌ ERROR: Request should have been aborted!');
    } catch (e: any) {
      const elapsed = (performance.now() - t0).toFixed(0);
      addLog(
        `✅ Aborted successfully after ${elapsed}ms: ${e?.name ?? 'Error'} - ${e?.message ?? String(e)}`
      );
    }
  };

  const handleNoAbort = async () => {
    addLog('Fetching with a Signal (but no abort)...');
    const controller = new AbortController();
    const t0 = performance.now();
    try {
      const res = await nitroFetch('https://httpbin.org/get', {
        signal: controller.signal,
      });
      const elapsed = (performance.now() - t0).toFixed(0);
      addLog(
        `✅ Fetch complete! HTTP ${res.status} arrived in ${elapsed}ms (Signal unbroken)`
      );
    } catch (e: any) {
      addLog(`❌ Unexpected error: ${e?.message ?? String(e)}`);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && styles.pressed,
            { backgroundColor: '#FFEDF1', borderColor: theme.colors.error },
          ]}
          onPress={handleImmediateAbort}
        >
          <Text style={styles.buttonTitle}>Immediate Abort</Text>
          <Text style={styles.buttonDesc}>
            Controller signals abort before fetch executes
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && styles.pressed,
            { backgroundColor: '#FFF5E5', borderColor: '#FF9500' },
          ]}
          onPress={handleDelayedAbort}
        >
          <Text style={styles.buttonTitle}>100ms Timeout</Text>
          <Text style={styles.buttonDesc}>
            Fetching a slow endpoint but aborting mid-flight
          </Text>
        </Pressable>

        <Pressable
          style={({ pressed }) => [
            styles.button,
            pressed && styles.pressed,
            { backgroundColor: '#E5F9E6', borderColor: theme.colors.success },
          ]}
          onPress={handleNoAbort}
        >
          <Text style={styles.buttonTitle}>Normal Fetch (No Abort)</Text>
          <Text style={styles.buttonDesc}>
            Checks that just attaching a signal doesn't break requests
          </Text>
        </Pressable>
      </View>

      <View style={styles.terminal}>
        <View style={styles.terminalHeader}>
          <Text style={styles.terminalTitle}>Abort Execution Trace</Text>
          <Pressable onPress={() => setLogs([])}>
            <Text style={styles.clearBtn}>Clear</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.terminalScroll}>
          {logs.map((l, i) => (
            <Text
              key={i}
              style={[
                styles.terminalLog,
                l.includes('✅') && { color: theme.colors.success },
                l.includes('❌') && { color: theme.colors.error },
              ]}
            >
              {l}
            </Text>
          ))}
          {logs.length === 0 && (
            <Text style={styles.terminalEmpty}>
              Awaiting controller signals...
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
  },
  content: {
    padding: theme.spacing.md,
    gap: theme.spacing.md,
  },
  button: {
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
  },
  pressed: {
    opacity: 0.7,
  },
  buttonTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: theme.colors.text,
    marginBottom: 4,
  },
  buttonDesc: {
    fontSize: 13,
    color: theme.colors.textSecondary,
  },
  terminal: {
    flex: 1,
    backgroundColor: '#1E1E1E',
    marginTop: theme.spacing.md,
  },
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
  clearBtn: {
    color: theme.colors.primary,
    fontSize: 12,
    fontWeight: '600',
  },
  terminalScroll: {
    padding: theme.spacing.md,
  },
  terminalLog: {
    color: '#D4D4D4',
    fontFamily: 'monospace',
    fontSize: 13,
    marginBottom: 8,
    lineHeight: 18,
  },
  terminalEmpty: {
    color: '#666',
    fontFamily: 'monospace',
    textAlign: 'center',
    marginTop: theme.spacing.xl,
  },
});
