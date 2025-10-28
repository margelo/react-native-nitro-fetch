import React from 'react';
import { useState, useEffect } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import './tests/text-decoder';
import './tests/web-text-decoder';
import './tests/prefetch';
import './tests/fetch-spec';
import type { TestResult, TestResults } from './types';
import { TestsContext } from './utils';
import { fetchStreamedData } from './stream';
import {
  fetch as nitroFetch,
  prefetchOnAppStart,
  clearAutoPrefetchQueue,
} from 'react-native-nitro-fetch';

interface Stats {
  suites: number;
  tests: number;
  passes: number;
  failures: number;
  duration: number;
}

interface SpeedTestResult {
  name: string;
  duration: number;
  size: number;
}

const runAllTests = async (
  onResult: (result: TestResult) => void
): Promise<Stats> => {
  const stats: Stats = {
    suites: 0,
    tests: 0,
    passes: 0,
    failures: 0,
    duration: 0,
  };

  const startTime = Date.now();

  for (const [suiteName, suite] of Object.entries(TestsContext)) {
    stats.suites++;

    for (const [testName, testFn] of Object.entries(suite.tests)) {
      try {
        await testFn();
        stats.passes++;
        onResult({
          type: 'correct',
          description: testName,
          indentation: 0,
          suiteName,
        });
        console.log(`✅ ${suiteName} - ${testName}`);
      } catch (error) {
        const err = error as Error;
        stats.failures++;
        onResult({
          type: 'incorrect',
          description: testName,
          indentation: 0,
          suiteName,
          errorMsg: err.message,
        });
        console.log(`❌ ${suiteName} - ${testName}: ${err.message}`);
      }
      stats.tests++;
    }
  }

  stats.duration = Date.now() - startTime;
  return stats;
};

const runSpeedTests = async (): Promise<SpeedTestResult[]> => {
  const speedResults: SpeedTestResult[] = [];

  // Create a large text to encode (10MB of repeated text)
  const testText =
    'Hello, World! 🌍 Testing UTF-8 encoding with emoji! 🚀 '.repeat(200000);
  const encoder = new TextEncoder();
  const encoded = encoder.encode(testText);

  const WARMUP_RUNS = 3; // Warm up the JIT compiler
  const TEST_RUNS = 10; // Number of times to run each test

  // Helper function to run a test multiple times
  const runTest = (testFn: () => void): number => {
    // Warmup runs (not measured)
    for (let i = 0; i < WARMUP_RUNS; i++) {
      testFn();
    }

    // Actual measured runs
    const times: number[] = [];
    for (let i = 0; i < TEST_RUNS; i++) {
      const start = performance.now();
      testFn();
      times.push(performance.now() - start);
    }

    // Return median time (more robust than average)
    times.sort((a, b) => a - b);
    return times[Math.floor(times.length / 2)];
  };

  return speedResults;
};

export default function TestScreen() {
  const [results, setResults] = useState<TestResults>({});
  const [stats, setStats] = useState<Stats | null>(null);
  const [running, setRunning] = useState(false);
  const [speedTestResults, setSpeedTestResults] = useState<
    SpeedTestResult[] | null
  >(null);
  const [runningSpeedTest, setRunningSpeedTest] = useState(false);
  const [prefetchVerified, setPrefetchVerified] = useState<{
    key: string;
    prefetchedTime: number;
    normalTime: number;
    wasPrefetched: boolean;
    speedup: number;
  } | null>(null);

  // Check for auto-prefetched data on mount
  useEffect(() => {
    // Wait a bit for the auto-prefetch to complete before checking
    const timer = setTimeout(() => {
      checkForAutoPrefetchedData();
    }, 1500); // 1.5 seconds delay - enough for 100kb file

    return () => clearTimeout(timer);
  }, []);

  const checkForAutoPrefetchedData = async () => {
    try {
      // Try to read the MMKV queue to get all prefetch keys
      const { MMKV } = require('react-native-mmkv');
      const storage = new MMKV();
      const raw = storage.getString('nitrofetch_autoprefetch_queue');
      if (!raw) return;

      const queue = JSON.parse(raw);
      if (!Array.isArray(queue) || queue.length === 0) return;

      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(`📋 Found ${queue.length} Prefetch Entries`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');

      // Warm-up once
      console.log('🔧 Warming up native modules...');
      try {
        const warmupUrl =
          'http://192.168.1.157:3000/data/1kb?warmup=' + Date.now();
        await nitroFetch(warmupUrl);
        console.log('✅ Warm-up complete\n');
      } catch (e) {
        console.log('Warm-up failed, continuing anyway\n');
      }

      // Check each entry
      const testResults: any[] = [];
      for (const entry of queue) {
        const { url, prefetchKey, maxAge = 5000 } = entry;
        if (!prefetchKey) continue;

        console.log(
          `━━━ Testing: ${prefetchKey} (${maxAge / 1000}s cache) ━━━`
        );

        try {
          const start = performance.now();
          const response = await nitroFetch(url, {
            headers: { prefetchKey },
          });
          const duration = performance.now() - start;
          await response.text();

          const wasCached = response.headers.get('nitroPrefetched') === 'true';
          const status = wasCached ? '✅ CACHED' : '❌ EXPIRED/MISSED';

          console.log(`${status} - ${duration.toFixed(2)}ms`);

          testResults.push({
            key: prefetchKey,
            maxAge,
            wasCached,
            duration,
          });
        } catch (e: any) {
          console.log(`❌ FAILED - ${e.message}`);
          testResults.push({
            key: prefetchKey,
            maxAge,
            wasCached: false,
            duration: 0,
            error: e.message,
          });
        }

        console.log('');
      }

      // Summary
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('📊 Summary:');
      const cached = testResults.filter((r) => r.wasCached).length;
      const expired = testResults.filter(
        (r) => !r.wasCached && !r.error
      ).length;
      const failed = testResults.filter((r) => r.error).length;

      console.log(`   ✅ Cached: ${cached}`);
      console.log(`   ❌ Expired: ${expired}`);
      if (failed > 0) console.log(`   💥 Failed: ${failed}`);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');

      // Show banner if any were successfully cached
      if (cached > 0) {
        const cachedResult = testResults.find((r) => r.wasCached);
        if (cachedResult) {
          setPrefetchVerified({
            key: cachedResult.key,
            prefetchedTime: cachedResult.duration,
            normalTime: 100, // Estimated network time
            wasPrefetched: true,
            speedup: 100 / cachedResult.duration,
          });
        }
      }
    } catch (e) {
      console.log('No auto-prefetch data to verify:', e);
    }
  };

  const handleRunTests = () => {
    // Clear previous results
    setResults({});
    setStats(null);
    setRunning(true);

    const addResult = (result: TestResult) => {
      setResults((prev) => {
        const suite = prev[result.suiteName] || { results: [] };
        return {
          ...prev,
          [result.suiteName]: {
            results: [...suite.results, result],
          },
        };
      });
    };

    runAllTests(addResult)
      .then((finalStats) => {
        setStats(finalStats);
        setRunning(false);
      })
      .catch((error) => {
        console.error('Test runner error:', error);
        setRunning(false);
      });
  };

  const handleRunSpeedTest = () => {
    setSpeedTestResults(null);
    setRunningSpeedTest(true);

    runSpeedTests()
      .then((speedResults) => {
        setSpeedTestResults(speedResults);
        setRunningSpeedTest(false);
      })
      .catch((error) => {
        console.error('Speed test error:', error);
        setRunningSpeedTest(false);
      });
  };

  const handleClearQueue = async () => {
    try {
      await clearAutoPrefetchQueue();
      console.log('✅ Prefetch queue cleared');
      alert('✅ Queue cleared!\n\nAll prefetch entries removed.');
    } catch (e) {
      console.error('Failed to clear queue:', e);
      alert('❌ Failed to clear queue.');
    }
  };

  const handleAddPrefetchEntries = async () => {
    try {
      const timestamp = Date.now();

      // Add 2-second cache entry
      const key2s = 'prefetch-2s-' + timestamp;
      const url2s = `http://192.168.1.157:3000/data/100kb?_=2s-${timestamp}`;

      await prefetchOnAppStart({
        url: url2s,
        prefetchKey: key2s,
        maxAge: 2000, // 2 seconds
        headers: { 'X-Test': 'auto-prefetch-2s' },
      });

      // Add 15-second cache entry
      const key15s = 'prefetch-15s-' + timestamp;
      const url15s = `http://192.168.1.157:3000/data/100kb?_=15s-${timestamp}`;

      await prefetchOnAppStart({
        url: url15s,
        prefetchKey: key15s,
        maxAge: 15000, // 15 seconds
        headers: { 'X-Test': 'auto-prefetch-15s' },
      });

      const message = `✅ 2 Prefetch Entries Added!

1️⃣ 2-second cache:
   🔑 ${key2s}
   ⏱️  Expires in 2s

2️⃣ 15-second cache:
   🔑 ${key15s}
   ⏱️  Expires in 15s

🔄 Close and restart the app!
   Check logs to see which ones are still cached.`;

      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log(message);
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');

      alert(message);
    } catch (e) {
      console.error('Failed to add prefetch entries:', e);
      alert('❌ Failed to add entries. MMKV might not be available.');
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Quick Crypto Tests</Text>

        {prefetchVerified && (
          <View
            style={[
              styles.prefetchBanner,
              prefetchVerified.wasPrefetched
                ? styles.prefetchSuccess
                : styles.prefetchWarning,
            ]}
          >
            <Text style={styles.prefetchTitle}>
              {prefetchVerified.wasPrefetched ? '✅' : '⚠️'} Auto-Prefetch
              Verification
            </Text>
            {prefetchVerified.wasPrefetched ? (
              <>
                <Text style={styles.prefetchText}>
                  ⚡ Prefetched: {prefetchVerified.prefetchedTime.toFixed(2)}ms
                </Text>
                <Text style={styles.prefetchText}>
                  🐌 Normal fetch: {prefetchVerified.normalTime.toFixed(2)}ms
                </Text>
                <Text style={styles.prefetchSpeedup}>
                  🚀 {prefetchVerified.speedup.toFixed(1)}x faster! Saved{' '}
                  {(
                    prefetchVerified.normalTime -
                    prefetchVerified.prefetchedTime
                  ).toFixed(2)}
                  ms
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.prefetchText}>
                  Fetched in {prefetchVerified.prefetchedTime.toFixed(2)}ms
                </Text>
                <Text style={styles.prefetchText}>
                  ⚠️ Data was NOT prefetched (normal fetch)
                </Text>
              </>
            )}
            <Text style={styles.prefetchKey}>Key: {prefetchVerified.key}</Text>
          </View>
        )}

        <TouchableOpacity
          style={[styles.button, running && styles.buttonDisabled]}
          onPress={handleRunTests}
          disabled={running}
        >
          <Text style={styles.buttonText}>
            {running ? 'Running...' : 'Run Tests'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button]}
          onPress={async () => {
            const totalStart = performance.now();
            const times: number[] = [];

            for (let i = 0; i < 100; i++) {
              const start = performance.now();
              await fetchStreamedData();
              const end = performance.now();
              const duration = end - start;
              times.push(duration);
              console.log(
                `Stream test ${i + 1}/100 took ${duration.toFixed(2)}ms`
              );
            }

            const totalEnd = performance.now();
            const totalDuration = totalEnd - totalStart;
            const avgDuration = times.reduce((a, b) => a + b, 0) / times.length;
            const minDuration = Math.min(...times);
            const maxDuration = Math.max(...times);

            console.log('='.repeat(50));
            console.log(
              `Completed 100 stream tests in ${totalDuration.toFixed(2)}ms`
            );
            console.log(`Average: ${avgDuration.toFixed(2)}ms`);
            console.log(`Min: ${minDuration.toFixed(2)}ms`);
            console.log(`Max: ${maxDuration.toFixed(2)}ms`);
            console.log('='.repeat(50));
          }}
        >
          <Text style={styles.buttonText}>Test stream (100x)</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.button,
            styles.speedButton,
            runningSpeedTest && styles.buttonDisabled,
          ]}
          onPress={handleRunSpeedTest}
          disabled={runningSpeedTest}
        >
          <Text style={styles.buttonText}>
            {runningSpeedTest ? 'Running Speed Test...' : 'Run Speed Test'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.cacheTestButton]}
          onPress={async () => {
            console.log('\n🧪 Starting Cache Test...\n');

            const SERVER_URL = 'http://192.168.1.157:3000';
            const testUrl = `${SERVER_URL}/cache-test`;

            console.log('═══════════════════════════════════════════');
            console.log('Test 1: Making cacheable requests (default)');
            console.log('═══════════════════════════════════════════\n');

            // Make 5 requests WITH cache (should hit server only once)
            const testUrlCache = `${testUrl}`;
            for (let i = 1; i <= 5; i++) {
              const start = performance.now();
              const response = await nitroFetch(testUrlCache, {
                headers: { 'Cache-Control': 'cache' },
              });
              const duration = performance.now() - start;
              const data = await response.json();

              console.log(`Request ${i}: ${duration.toFixed(2)}ms`);
              console.log(`  - Request ID: ${data.requestId}`);
              console.log(`  - Server Timestamp: ${data.serverTimestamp}`);
              console.log(`  - Cacheable: ${data.cacheable}`);
              console.log('');

              await new Promise((resolve) => setTimeout(resolve, 500));
            }

            console.log('\n═══════════════════════════════════════════');
            console.log('Test 2: Making no-cache requests');
            console.log('═══════════════════════════════════════════\n');

            // Wait a bit
            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Make 5 requests with no-cache (should hit server every time)
            for (let i = 1; i <= 5; i++) {
              const start = performance.now();
              const response = await nitroFetch(testUrl, {
                cache: 'no-cache',
                headers: { 'Cache-Control': 'no-cache' },
              });
              const duration = performance.now() - start;
              const data = await response.json();

              console.log(`Request ${i}: ${duration.toFixed(2)}ms`);
              console.log(`  - Request ID: ${data.requestId}`);
              console.log(`  - Server Timestamp: ${data.serverTimestamp}`);
              console.log(`  - Cacheable: ${data.cacheable}`);
              console.log('');

              await new Promise((resolve) => setTimeout(resolve, 500));
            }

            console.log('═══════════════════════════════════════════');
            console.log('✅ Cache Test Complete!');
            console.log('═══════════════════════════════════════════');
            console.log('Check the SERVER logs to see:');
            console.log(
              '  - Test 1 should show 1 server hit (cached after first)'
            );
            console.log('  - Test 2 should show 5 server hits (no-cache)');
            console.log('═══════════════════════════════════════════\n');

            alert(
              '✅ Cache test complete!\n\nCheck the console logs on both CLIENT and SERVER to see the results.'
            );
          }}
        >
          <Text style={styles.buttonText}>🔍 Test Cache</Text>
        </TouchableOpacity>

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[styles.button, styles.prefetchButton, styles.halfButton]}
            onPress={handleAddPrefetchEntries}
          >
            <Text style={styles.buttonText}>🚀 Add (2s+15s)</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.button, styles.clearButton, styles.halfButton]}
            onPress={handleClearQueue}
          >
            <Text style={styles.buttonText}>🗑️ Clear Queue</Text>
          </TouchableOpacity>
        </View>

        {running && <Text style={styles.status}>Running tests...</Text>}
        {runningSpeedTest && (
          <Text style={styles.status}>Running speed test...</Text>
        )}
        {stats && (
          <View style={styles.statsContainer}>
            <Text style={styles.stats}>
              {stats.tests} tests | {stats.passes} passed | {stats.failures}{' '}
              failed | {stats.duration}ms
            </Text>
            <Text
              style={[
                styles.summary,
                stats.failures === 0 ? styles.success : styles.failure,
              ]}
            >
              {stats.failures === 0 ? '✅ ALL PASSED' : '❌ SOME FAILED'}
            </Text>
          </View>
        )}
        {speedTestResults && speedTestResults.length > 0 && (
          <View style={styles.speedTestContainer}>
            <Text style={styles.speedTestTitle}>Speed Test Results:</Text>
            <Text style={styles.speedTestSize}>
              Data size: {(speedTestResults[0]!.size / 1024 / 1024).toFixed(2)}{' '}
              MB
            </Text>
            {speedTestResults.map((result, index) => {
              const fastest =
                Math.min(...speedTestResults.map((r) => r.duration)) ===
                result.duration;
              return (
                <View
                  key={index}
                  style={[
                    styles.speedTestResult,
                    fastest && styles.speedTestFastest,
                  ]}
                >
                  <Text
                    style={[
                      styles.speedTestName,
                      fastest && styles.speedTestFastestText,
                    ]}
                  >
                    {result.name} {fastest && '🏆'}
                  </Text>
                  <Text
                    style={[
                      styles.speedTestDuration,
                      fastest && styles.speedTestFastestText,
                    ]}
                  >
                    {result.duration.toFixed(2)}ms
                  </Text>
                </View>
              );
            })}
          </View>
        )}
      </View>

      <ScrollView style={styles.scrollView}>
        {Object.entries(results).map(([suiteName, suite]) => (
          <View key={suiteName} style={styles.suite}>
            <Text style={styles.suiteName}>{suiteName}</Text>
            {suite.results.map((result, index) => (
              <View
                key={`${result.description}-${index}`}
                style={styles.testResult}
              >
                <Text
                  style={[
                    styles.testText,
                    result.type === 'correct'
                      ? styles.testPassed
                      : styles.testFailed,
                  ]}
                >
                  {result.type === 'correct' ? '✅' : '❌'} {result.description}
                </Text>
                {result.errorMsg && (
                  <Text style={styles.errorMsg}>{result.errorMsg}</Text>
                )}
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  header: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  button: {
    backgroundColor: '#2196F3',
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
    marginVertical: 12,
    alignItems: 'center',
  },
  speedButton: {
    backgroundColor: '#4CAF50',
  },
  prefetchButton: {
    backgroundColor: '#9C27B0', // Purple for prefetch
  },
  clearButton: {
    backgroundColor: '#F44336', // Red for clear
  },
  cacheTestButton: {
    backgroundColor: '#FF9800', // Orange for cache test
  },
  buttonRow: {
    flexDirection: 'row',
    marginVertical: 12,
    width: '100%',
  },
  halfButton: {
    flex: 1,
    marginVertical: 0,
    marginHorizontal: 6,
  },
  buttonDisabled: {
    backgroundColor: '#bbb',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  status: {
    fontSize: 16,
    color: '#666',
  },
  statsContainer: {
    marginTop: 8,
  },
  stats: {
    fontSize: 14,
    color: '#666',
  },
  summary: {
    fontSize: 18,
    fontWeight: 'bold',
    marginTop: 4,
  },
  success: {
    color: '#4caf50',
  },
  failure: {
    color: '#f44336',
  },
  scrollView: {
    flex: 1,
  },
  suite: {
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  suiteName: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 8,
  },
  testResult: {
    paddingVertical: 4,
    paddingLeft: 8,
  },
  testText: {
    fontSize: 14,
  },
  testPassed: {
    color: '#4caf50',
  },
  testFailed: {
    color: '#f44336',
  },
  errorMsg: {
    fontSize: 12,
    color: '#f44336',
    marginTop: 2,
    marginLeft: 20,
  },
  speedTestContainer: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  speedTestTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 8,
    color: '#333',
  },
  speedTestResult: {
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#ddd',
    borderRadius: 4,
  },
  speedTestFastest: {
    backgroundColor: '#e8f5e9',
    borderLeftWidth: 3,
    borderLeftColor: '#4CAF50',
  },
  speedTestName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  speedTestFastestText: {
    color: '#2E7D32',
    fontWeight: 'bold',
  },
  speedTestDuration: {
    fontSize: 14,
    color: '#4CAF50',
    marginTop: 2,
  },
  speedTestSize: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
    marginBottom: 8,
  },
  prefetchBanner: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
    borderWidth: 2,
  },
  prefetchSuccess: {
    backgroundColor: '#e8f5e9',
    borderColor: '#4CAF50',
  },
  prefetchWarning: {
    backgroundColor: '#fff3e0',
    borderColor: '#FF9800',
  },
  prefetchTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    marginBottom: 4,
    color: '#333',
  },
  prefetchText: {
    fontSize: 14,
    color: '#555',
    marginVertical: 2,
  },
  prefetchKey: {
    fontSize: 11,
    color: '#999',
    marginTop: 4,
    fontFamily: 'monospace',
  },
  prefetchSpeedup: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#2E7D32',
    marginTop: 6,
  },
});
