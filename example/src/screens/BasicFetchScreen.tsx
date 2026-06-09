import React from 'react';
import { View, Text, StyleSheet, Pressable, ScrollView } from 'react-native';
import * as RNFS from '@dr.pogodin/react-native-fs';
import { fetch as nitroFetch } from 'react-native-nitro-fetch';
import { theme } from '../theme';

export function BasicFetchScreen() {
  const [logs, setLogs] = React.useState<string[]>([]);

  const addLog = (msg: string) => {
    setLogs((prev) => [`[${new Date().toLocaleTimeString()}] ${msg}`, ...prev]);
  };

  const tests = [
    {
      title: 'Simple GET (JSON)',
      action: async () => {
        addLog('GET https://httpbin.org/get...');
        try {
          const res = await nitroFetch('https://httpbin.org/get');
          const json = await res.json();
          addLog(
            `✅ Success! Headers: ${Object.keys(json.headers).length}\nOrigin: ${json.origin}`
          );
        } catch (e: any) {
          addLog(`❌ Failed: ${e.message}`);
        }
      },
    },
    {
      title: 'GET Text / HTML',
      action: async () => {
        addLog('GET https://example.com...');
        try {
          const res = await nitroFetch('https://example.com');
          const text = await res.text();
          addLog(`✅ Success! Fetched HTML length: ${text.length} chars`);
        } catch (e: any) {
          addLog(`❌ Failed: ${e.message}`);
        }
      },
    },
    {
      title: 'GET User Agent Info',
      action: async () => {
        addLog('GET https://httpbin.org/user-agent...');
        try {
          const res = await nitroFetch('https://httpbin.org/user-agent');
          const json = await res.json();
          addLog(`✅ Success! User-Agent:\n${json['user-agent']}`);
        } catch (e: any) {
          addLog(`❌ Failed: ${e.message}`);
        }
      },
    },
    {
      title: 'GET 404 Not Found',
      action: async () => {
        addLog('GET https://httpstat.us/404...');
        try {
          const res = await nitroFetch('https://httpstat.us/404');
          addLog(
            `✅ Request completed. HTTP Status: ${res.status} ${res.statusText}`
          );
        } catch (e: any) {
          addLog(`❌ Request threw: ${e.message}`);
        }
      },
    },
    {
      title: 'GET Binary (arrayBuffer)',
      action: async () => {
        addLog('GET https://httpbin.org/image/png...');
        try {
          const res = await nitroFetch('https://httpbin.org/image/png');
          const buf = await res.arrayBuffer();
          const bytes = new Uint8Array(buf);
          // PNG files always start with the 8-byte signature 89 50 4E 47 0D 0A 1A 0A
          const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
          const valid = bytes.length > 8 && sig.every((b, i) => bytes[i] === b);
          if (valid) {
            addLog(
              `✅ Binary intact! ${bytes.length} bytes, valid PNG signature\n` +
                `First bytes: ${Array.from(bytes.slice(0, 8))
                  .map((b) => b.toString(16).padStart(2, '0'))
                  .join(' ')}`
            );
          } else {
            addLog(
              `❌ Binary corrupted/empty! ${bytes.length} bytes, bad signature`
            );
          }
        } catch (e: any) {
          addLog(`❌ Failed: ${e.message}`);
        }
      },
    },
    {
      title: 'Read Local File',
      action: async () => {
        const path = `${RNFS.CachesDirectoryPath}/nitro-demo.csv`;
        addLog(`Writing ${path}...`);
        try {
          await RNFS.writeFile(path, 'col1,col2\nfoo,bar\n', 'utf8');
          // Read it back two ways: a file:// URL and a scheme-less absolute path
          const viaUrl = await (await nitroFetch(`file://${path}`)).text();
          const viaPath = await (await nitroFetch(path)).text();
          addLog(
            `✅ file://: ${viaUrl.length} chars\n✅ scheme-less path: ${viaPath.trim().replace(/\n/g, ' / ')}`
          );
        } catch (e: any) {
          addLog(`❌ Failed: ${e.message}`);
        }
      },
    },
  ];

  return (
    <View style={styles.container}>
      <View style={styles.grid}>
        {tests.map((test, i) => (
          <Pressable
            key={i}
            style={({ pressed }) => [
              styles.card,
              pressed && styles.cardPressed,
            ]}
            onPress={test.action}
          >
            <Text style={styles.cardTitle}>{test.title}</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.consoleWrapper}>
        <View style={styles.consoleHeader}>
          <Text style={styles.consoleTitle}>Console Output</Text>
          <Pressable onPress={() => setLogs([])}>
            <Text style={styles.clearText}>Clear</Text>
          </Pressable>
        </View>
        <ScrollView style={styles.consoleArea}>
          {logs.map((log, i) => (
            <Text
              key={i}
              style={[
                styles.logLine,
                log.includes('✅') && styles.successLine,
                log.includes('❌') && styles.errorLine,
              ]}
            >
              {log}
            </Text>
          ))}
          {logs.length === 0 && (
            <Text style={styles.emptyConsole}>Output goes here...</Text>
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
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: theme.spacing.sm,
  },
  card: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: theme.colors.card,
    padding: theme.spacing.md,
    borderRadius: theme.borderRadius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: theme.colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    height: 80,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  cardPressed: {
    opacity: 0.7,
    backgroundColor: '#F8F8F8',
  },
  cardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: theme.colors.text,
    textAlign: 'center',
  },
  consoleWrapper: {
    flex: 1,
    backgroundColor: '#2B2B2B',
    borderRadius: theme.borderRadius.md,
    marginTop: theme.spacing.lg,
    overflow: 'hidden',
  },
  consoleHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: theme.spacing.sm,
    paddingHorizontal: theme.spacing.md,
    backgroundColor: '#1E1E1E',
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
  consoleArea: {
    padding: theme.spacing.md,
  },
  logLine: {
    color: '#FFF',
    fontFamily: 'monospace',
    fontSize: 13,
    marginBottom: 8,
    lineHeight: 18,
  },
  successLine: {
    color: '#A8D592',
  },
  errorLine: {
    color: '#FF8A8A',
  },
  emptyConsole: {
    color: '#666',
    fontFamily: 'monospace',
    textAlign: 'center',
    marginTop: theme.spacing.xl,
  },
});
