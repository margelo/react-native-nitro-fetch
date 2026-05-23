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

// Registered natively from MainApplication.onCreate() (Android) and
// application(_:didFinishLaunchingWithOptions:) (iOS). Fires on the
// very first cold launch — no JS-side scheduling required.
const NATIVE_PREFETCH_URL = 'https://httpbin.org/anything/native-prefetch-test';
const NATIVE_PREFETCH_KEY = 'harness-native-prefetch';

const POST_PREFETCH_URL = 'https://httpbin.org/post';
const POST_PREFETCH_KEY = 'post-prefetch';

const NATIVE_POST_PREFETCH_URL = 'https://httpbin.org/post';
const NATIVE_POST_PREFETCH_KEY = 'harness-native-post-prefetch';

const JSON_PREFETCH_URL = 'https://httpbin.org/post';
const JSON_PREFETCH_KEY = 'json-post-prefetch';
const JSON_PAYLOAD = { user: 'alice', tags: ['a', 'b'], count: 42 };

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

  const handleConsumeNativePrefetch = async () => {
    try {
      addLog('Consuming native-registered prefetch...');
      const t0 = performance.now();
      const res = await nitroFetch(NATIVE_PREFETCH_URL, {
        headers: { prefetchKey: NATIVE_PREFETCH_KEY },
      });
      const text = await res.text();
      const prefHeader = res.headers.get('nitroPrefetched');
      const time = (performance.now() - t0).toFixed(0);
      addLog(
        `✅ Fetched in ${time}ms\nnitroPrefetched: ${prefHeader ?? 'null'}\n` +
          `(registered natively in MainApplication / AppDelegate, fires on first cold launch)\n` +
          `Response: ${text.substring(0, 60)}...`
      );
    } catch (e: any) {
      addLog(`❌ Native prefetch consume error: ${e?.message ?? String(e)}`);
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

  const buildPostFormData = () => {
    const fd = new FormData();
    fd.append('user', 'alice');
    fd.append('msg', 'hello from prefetch');
    return fd;
  };

  const handleSchedulePost = async () => {
    try {
      addLog('Scheduling POST+FormData prefetch on app start...');
      await prefetchOnAppStart(POST_PREFETCH_URL, {
        method: 'POST',
        body: buildPostFormData(),
        prefetchKey: POST_PREFETCH_KEY,
      });
      addLog(
        '✅ Scheduled POST in queue.\nKill + relaunch app, then tap "Consume POST".'
      );
    } catch (e: any) {
      addLog(`❌ Schedule POST error: ${e?.message ?? String(e)}`);
    }
  };

  const handleConsumePost = async () => {
    try {
      addLog('Consuming JS-scheduled POST prefetch...');
      const t0 = performance.now();
      const res = await nitroFetch(POST_PREFETCH_URL, {
        method: 'POST',
        body: buildPostFormData(),
        headers: { prefetchKey: POST_PREFETCH_KEY },
      });
      const body = await res.json();
      const prefHeader = res.headers.get('nitroPrefetched');
      const time = (performance.now() - t0).toFixed(0);
      addLog(
        `✅ Fetched in ${time}ms\nnitroPrefetched: ${prefHeader ?? 'null'}\n` +
          `Echo form.user: ${body?.form?.user ?? '(missing)'}`
      );
    } catch (e: any) {
      addLog(`❌ Consume POST error: ${e?.message ?? String(e)}`);
    }
  };

  const handleScheduleJsonPost = async () => {
    try {
      addLog('Scheduling POST+JSON prefetch on app start...');
      await prefetchOnAppStart(JSON_PREFETCH_URL, {
        method: 'POST',
        body: JSON.stringify(JSON_PAYLOAD),
        headers: { 'Content-Type': 'application/json' },
        prefetchKey: JSON_PREFETCH_KEY,
      });
      addLog(
        '✅ Scheduled JSON POST in queue.\nKill + relaunch app, then tap "Consume JSON POST".'
      );
    } catch (e: any) {
      addLog(`❌ Schedule JSON error: ${e?.message ?? String(e)}`);
    }
  };

  const handleConsumeJsonPost = async () => {
    try {
      addLog('Consuming JS-scheduled JSON POST prefetch...');
      const t0 = performance.now();
      const res = await nitroFetch(JSON_PREFETCH_URL, {
        method: 'POST',
        body: JSON.stringify(JSON_PAYLOAD),
        headers: {
          'Content-Type': 'application/json',
          'prefetchKey': JSON_PREFETCH_KEY,
        },
      });
      const body = await res.json();
      const prefHeader = res.headers.get('nitroPrefetched');
      const time = (performance.now() - t0).toFixed(0);
      addLog(
        `✅ Fetched in ${time}ms\nnitroPrefetched: ${prefHeader ?? 'null'}\n` +
          `Echo json.user: ${body?.json?.user ?? '(missing)'}, count: ${body?.json?.count ?? '(missing)'}`
      );
    } catch (e: any) {
      addLog(`❌ Consume JSON error: ${e?.message ?? String(e)}`);
    }
  };

  const handleConsumeNativePost = async () => {
    try {
      addLog('Consuming native-registered POST prefetch...');
      const t0 = performance.now();
      const fd = new FormData();
      fd.append('user', 'alice');
      fd.append('msg', 'hello from native');
      const res = await nitroFetch(NATIVE_POST_PREFETCH_URL, {
        method: 'POST',
        body: fd,
        headers: { prefetchKey: NATIVE_POST_PREFETCH_KEY },
      });
      const body = await res.json();
      const prefHeader = res.headers.get('nitroPrefetched');
      const time = (performance.now() - t0).toFixed(0);
      addLog(
        `✅ Fetched in ${time}ms\nnitroPrefetched: ${prefHeader ?? 'null'}\n` +
          `(registered in MainApplication / AppDelegate)\n` +
          `Echo form.user: ${body?.form?.user ?? '(missing)'}`
      );
    } catch (e: any) {
      addLog(`❌ Consume native POST error: ${e?.message ?? String(e)}`);
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

        <View style={styles.row}>
          <Pressable
            style={[styles.button, styles.primaryBtn]}
            onPress={handleConsumeNativePrefetch}
          >
            <Text style={[styles.buttonText, styles.primaryBtnText]}>
              Consume Native Prefetch
            </Text>
            <Text style={[styles.buttonSub, styles.primaryBtnSub]}>
              Registered in MainApplication / AppDelegate
            </Text>
          </Pressable>
        </View>

        <View style={styles.row}>
          <Pressable style={styles.button} onPress={handleSchedulePost}>
            <Text style={styles.buttonText}>Schedule POST</Text>
            <Text style={styles.buttonSub}>
              POST + FormData to queue; needs kill + relaunch
            </Text>
          </Pressable>
          <Pressable
            style={[styles.button, styles.primaryBtn]}
            onPress={handleConsumePost}
          >
            <Text style={[styles.buttonText, styles.primaryBtnText]}>
              Consume POST
            </Text>
            <Text style={[styles.buttonSub, styles.primaryBtnSub]}>
              Verifies nitroPrefetched + echoed form
            </Text>
          </Pressable>
        </View>

        <View style={styles.row}>
          <Pressable style={styles.button} onPress={handleScheduleJsonPost}>
            <Text style={styles.buttonText}>Schedule JSON POST</Text>
            <Text style={styles.buttonSub}>
              POST + application/json; kill + relaunch
            </Text>
          </Pressable>
          <Pressable
            style={[styles.button, styles.primaryBtn]}
            onPress={handleConsumeJsonPost}
          >
            <Text style={[styles.buttonText, styles.primaryBtnText]}>
              Consume JSON POST
            </Text>
            <Text style={[styles.buttonSub, styles.primaryBtnSub]}>
              Verifies echoed json.user / json.count
            </Text>
          </Pressable>
        </View>

        <View style={styles.row}>
          <Pressable
            style={[styles.button, styles.primaryBtn]}
            onPress={handleConsumeNativePost}
          >
            <Text style={[styles.buttonText, styles.primaryBtnText]}>
              Consume Native POST
            </Text>
            <Text style={[styles.buttonSub, styles.primaryBtnSub]}>
              POST registered in MainApplication / AppDelegate
            </Text>
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
