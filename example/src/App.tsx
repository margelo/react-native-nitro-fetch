import React from 'react';
import {
  Text,
  View,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { fetch as nitroFetch } from 'react-native-nitro-fetch';
import { fetchStreamedData } from './stream';
import TestScreen from './Tests';

// Update this to your computer's local IP address
// You can find it by running: ipconfig getifaddr en0 (macOS) or ipconfig (Windows)
const SERVER_URL = 'http://192.168.1.157:3000';

// Number of times to run each test (for averaging)
const TEST_ITERATIONS = 20; // Reduced from 15 to avoid OOM with large payloads

type TestResult = {
  endpoint: string;
  nativeDuration: number;
  nitroDuration: number;
  dataSize: string;
  nativeCached?: boolean;
  nitroCached?: boolean;
  prevBestNitro?: number;
  error?: string;
  dataMatch?: boolean; // true if data matches, false if mismatch
  dataMismatch?: string; // details of mismatch
};

export default function App() {
  const [results, setResults] = React.useState<TestResult[]>([]);
  const [testing, setTesting] = React.useState(false);
  const [cacheEnabled, setCacheEnabled] = React.useState(false);
  const [bestTimes, setBestTimes] = React.useState<Record<string, number>>({});
  const [seenRequestIds, setSeenRequestIds] = React.useState<Set<string>>(
    new Set()
  );

  return <TestScreen />;

  // Helper function to calculate robust average (resistant to outliers)
  const calculateRobustAverage = (values: number[]) => {
    if (values.length === 0) return 0;

    // Sort the values
    const sorted = [...values].sort((a, b) => a - b);

    // For small sample sizes (< 4), just use median
    if (sorted.length < 4) {
      const mid = Math.floor(sorted.length / 2);
      return sorted.length % 2 === 0
        ? (sorted[mid - 1] + sorted[mid]) / 2
        : sorted[mid];
    }

    // For medium samples (4-9), use trimmed mean (30%)
    if (sorted.length < 10) {
      const trimPercent = 0.3;
      const trimCount = Math.floor(sorted.length * trimPercent);
      const trimmed = sorted.slice(trimCount, sorted.length - trimCount);
      return trimmed.reduce((sum, val) => sum + val, 0) / trimmed.length;
    }

    // For larger samples (10+), use Interquartile Mean (IQR)
    // This takes only the middle 50% of data (Q1 to Q3)
    const q1Index = Math.floor(sorted.length * 0.25);
    const q3Index = Math.floor(sorted.length * 0.75);
    const iqrValues = sorted.slice(q1Index, q3Index + 1);

    return iqrValues.reduce((sum, val) => sum + val, 0) / iqrValues.length;
  };

  // Helper function to compare two ArrayBuffers
  const compareArrayBuffers = (
    buffer1: ArrayBuffer,
    buffer2: ArrayBuffer
  ): { match: boolean; details?: string } => {
    if (buffer1.byteLength !== buffer2.byteLength) {
      return {
        match: false,
        details: `Size mismatch: ${buffer1.byteLength} vs ${buffer2.byteLength} bytes`,
      };
    }

    const arr1 = new Uint8Array(buffer1);
    const arr2 = new Uint8Array(buffer2);

    // Compare ALL bytes and track mismatches
    const mismatches: number[] = [];
    let totalMismatches = 0;

    for (let i = 0; i < arr1.length; i++) {
      if (arr1[i] !== arr2[i]) {
        totalMismatches++;
        // Store first 10 for detailed logging
        if (mismatches.length < 10) {
          mismatches.push(i);
        }
      }
    }

    if (totalMismatches > 0) {
      const firstMismatch = mismatches[0];
      const contextStart = Math.max(0, firstMismatch - 5);
      const contextEnd = Math.min(arr1.length, firstMismatch + 6);

      // Get context around first mismatch
      const nativeContext = Array.from(arr1.slice(contextStart, contextEnd))
        .map((b, i) => {
          const pos = contextStart + i;
          const marker = pos === firstMismatch ? '→' : ' ';
          return `${marker}[${pos}]:${b}`;
        })
        .join(' ');

      const nitroContext = Array.from(arr2.slice(contextStart, contextEnd))
        .map((b, i) => {
          const pos = contextStart + i;
          const marker = pos === firstMismatch ? '→' : ' ';
          return `${marker}[${pos}]:${b}`;
        })
        .join(' ');

      // Check first and last 10 bytes
      const first10Native = Array.from(arr1.slice(0, 10)).join(',');
      const first10Nitro = Array.from(arr2.slice(0, 10)).join(',');
      const last10Native = Array.from(arr1.slice(-10)).join(',');
      const last10Nitro = Array.from(arr2.slice(-10)).join(',');

      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('🔍 DATA MISMATCH DETAILS:');
      console.log(`  Total bytes compared: ${arr1.length}`);
      console.log(`  Total mismatches found: ${totalMismatches}`);
      console.log(
        `  Match rate: ${(((arr1.length - totalMismatches) / arr1.length) * 100).toFixed(2)}%`
      );
      console.log(
        `  First mismatch at byte: ${firstMismatch} (${((firstMismatch / buffer1.byteLength) * 100).toFixed(2)}% through data)`
      );
      console.log(`  Native byte value: ${arr1[firstMismatch]}`);
      console.log(`  Nitro byte value:  ${arr2[firstMismatch]}`);
      console.log('\n📍 Context around first mismatch:');
      console.log(`  Native: ${nativeContext}`);
      console.log(`  Nitro:  ${nitroContext}`);
      console.log('\n🔢 First 10 bytes:');
      console.log(`  Native: [${first10Native}]`);
      console.log(`  Nitro:  [${first10Nitro}]`);
      console.log('\n🔢 Last 10 bytes:');
      console.log(`  Native: [${last10Native}]`);
      console.log(`  Nitro:  [${last10Nitro}]`);
      if (mismatches.length > 1) {
        console.log(
          `\n📊 First 10 mismatch positions: ${mismatches.join(', ')}`
        );
      }
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

      return {
        match: false,
        details: `${totalMismatches} byte${totalMismatches > 1 ? 's' : ''} mismatch (${((totalMismatches / arr1.length) * 100).toFixed(2)}% of data)`,
      };
    }

    return { match: true };
  };

  // Helper function to check if response was cached
  const isCached = (response: Response): boolean => {
    const get = (k: string) => response.headers.get(k);

    // Check Age header (if > 0, it's cached)
    const age = get('age');
    if (age && Number(age) > 0) return true;

    // Check x-cache-hits header
    const hits = get('x-cache-hits');
    if (hits && Number(hits) > 0) return true;

    // Check X-Request-Id (if we've seen it before, it's cached)
    const xRequestId = get('x-request-id');
    if (xRequestId) {
      if (seenRequestIds.has(xRequestId)) {
        return true;
      }
      // Remember this request ID
      setSeenRequestIds((prev) => new Set(prev).add(xRequestId));
    }

    // Combine multiple cache headers and check for HIT/MISS indicators
    const combined = (
      (get('x-cache') || '') +
      ' ' +
      (get('x-cache-status') || '') +
      ' ' +
      (get('x-cache-remote') || '') +
      ' ' +
      (get('cf-cache-status') || '') +
      ' ' +
      (get('via') || '')
    ).toUpperCase();

    if (combined.includes('HIT') || combined.includes('REVALIDATED')) {
      return true;
    }
    if (combined.includes('MISS')) {
      return false;
    }

    return false;
  };

  const runTest = async (url: string, label: string) => {
    const iterations = TEST_ITERATIONS;
    try {
      const nativeDurations: number[] = [];
      const nitroDurations: number[] = [];
      let dataSize = 0;
      let anyCached = false;
      let dataMatch = true;
      let dataMismatchDetails: string | undefined;

      // WARMUP: Run a few requests first to warm up the connection (don't count these)
      console.log(`🔥 Warming up for ${label}...`);
      for (let i = 0; i < 3; i++) {
        const separator = url.includes('?') ? '&' : '?';
        const warmupUrl = `${url}${separator}_warmup=${Date.now()}-${Math.random()}`;
        const noCacheHeaders = {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        };
        try {
          await fetch(warmupUrl, {
            headers: noCacheHeaders,
            cache: 'no-store',
          });
          await nitroFetch(warmupUrl, {
            headers: noCacheHeaders,
            cache: 'no-store',
          });
        } catch (e) {
          // Warmup failed, continue anyway
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Additional delay after warmup
      await new Promise((resolve) => setTimeout(resolve, 500));
      console.log(`✅ Warmup complete for ${label}`);

      // Run the test multiple times with RANDOMIZED order
      for (let i = 0; i < iterations; i++) {
        // ALWAYS disable cache with unique URLs and headers
        const separator = url.includes('?') ? '&' : '?';
        const testUrlNitro = `${url}${separator}_=${Date.now()}-${Math.random()}`;
        const testUrlNative = `${url}${separator}_=${Date.now()}-${Math.random()}`;
        const headers: Record<string, string> = {
          'Cache-Control': 'no-cache, no-store, must-revalidate',
          'Pragma': 'no-cache',
          'Expires': '0',
        };

        // RANDOMIZE ORDER: 50% chance to run Native first, 50% to run Nitro first
        const runNativeFirst = Math.random() < 0.5;

        let nativeData: ArrayBuffer;
        let nativeDuration: number;
        let nativeResponse: Response;
        let nitroData: ArrayBuffer;
        let nitroDuration: number;
        let nitroResponse: Response;

        if (runNativeFirst) {
          // Test Native Fetch first
          const nativeStart = performance.now();
          nativeResponse = await fetch(testUrlNative, {
            headers,
            cache: 'no-store',
          });
          nativeData = await nativeResponse.arrayBuffer();
          nativeDuration = performance.now() - nativeStart;
          nativeDurations.push(nativeDuration);

          // Small delay between tests to allow GC
          await new Promise((resolve) => setTimeout(resolve, 200));

          // Test Nitro Fetch second
          const nitroStart = performance.now();
          nitroResponse = await nitroFetch(testUrlNitro, {
            headers,
            cache: 'no-store',
          });
          nitroData = await nitroResponse.arrayBuffer();
          nitroDuration = performance.now() - nitroStart;
          nitroDurations.push(nitroDuration);
        } else {
          // Test Nitro Fetch first
          const nitroStart = performance.now();
          nitroResponse = await nitroFetch(testUrlNitro, {
            headers,
            cache: 'no-store',
          });
          nitroData = await nitroResponse.arrayBuffer();
          nitroDuration = performance.now() - nitroStart;
          nitroDurations.push(nitroDuration);

          // Small delay between tests to allow GC
          await new Promise((resolve) => setTimeout(resolve, 200));

          // Test Native Fetch second
          const nativeStart = performance.now();
          nativeResponse = await fetch(testUrlNative, {
            headers,
            cache: 'no-store',
          });
          nativeData = await nativeResponse.arrayBuffer();
          nativeDuration = performance.now() - nativeStart;
          nativeDurations.push(nativeDuration);
        }

        console.log(
          `Iteration ${i + 1}: Native=${nativeDuration.toFixed(0)}ms, Nitro=${nitroDuration.toFixed(0)}ms (${runNativeFirst ? 'Native→Nitro' : 'Nitro→Native'})`
        );

        if (i === 0) {
          dataSize = nativeData.byteLength;
        }

        const nativeCached = isCached(nativeResponse);
        const nitroCached = isCached(nitroResponse);
        if (nativeCached || nitroCached) anyCached = true;

        // Compare data integrity (only on first iteration to save time)
        if (i === 0 && dataMatch) {
          const comparison = compareArrayBuffers(nativeData, nitroData);
          if (!comparison.match) {
            dataMatch = false;
            dataMismatchDetails = comparison.details;
            console.log(`❌ Data mismatch for ${label}: ${comparison.details}`);
          } else {
            console.log(`✅ Data matches for ${label}`);
          }
        }

        // Small delay before next iteration to allow GC
        if (i < iterations - 1) {
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }

      // Calculate averages using robust method (resistant to outliers)
      const avgNativeDuration = calculateRobustAverage(nativeDurations);
      const avgNitroDuration = calculateRobustAverage(nitroDurations);

      // Get previous best time for this endpoint
      const prevBestNitro = bestTimes[label];

      // Update best time if this is better
      if (!bestTimes[label] || avgNitroDuration < bestTimes[label]) {
        setBestTimes((prev) => ({ ...prev, [label]: avgNitroDuration }));
      }

      const result: TestResult = {
        endpoint: label,
        nativeDuration: avgNativeDuration,
        nitroDuration: avgNitroDuration,
        dataSize: `${(dataSize / 1024).toFixed(2)} KB`,
        nativeCached: anyCached,
        nitroCached: anyCached,
        prevBestNitro,
        dataMatch,
        dataMismatch: dataMismatchDetails,
      };

      setResults((prev) => [result, ...prev]);

      return result;
    } catch (error: any) {
      const result: TestResult = {
        endpoint: label,
        nativeDuration: 0,
        nitroDuration: 0,
        dataSize: 'N/A',
        error: error,
      };
      setResults((prev) => [result, ...prev]);
      return result;
    }
  };

  // Calculate average performance improvement
  const calculateAverageImprovement = () => {
    const validResults = results.filter(
      (r) => !r.error && r.nativeDuration > 0
    );
    if (validResults.length === 0) return null;

    const totalImprovement = validResults.reduce((sum, result) => {
      const improvement =
        ((result.nativeDuration - result.nitroDuration) /
          result.nativeDuration) *
        100;
      return sum + improvement;
    }, 0);

    return totalImprovement / validResults.length;
  };

  const runAllTests = async () => {
    setTesting(true);
    setResults([]);
    try {
      const tests = [
        // Quick Tests
        // { url: `${SERVER_URL}/health`, label: 'Health Check' },
        // { url: `${SERVER_URL}/headers`, label: 'Headers' },

        // Text Data
        // { url: `${SERVER_URL}/data/1kb`, label: '1 KB' },
        // { url: `${SERVER_URL}/data/10kb`, label: '10 KB' },
        // { url: `${SERVER_URL}/data/100kb`, label: '100 KB' },
        { url: `${SERVER_URL}/data/1mb`, label: '1 MB' },
        { url: `${SERVER_URL}/data/5mb`, label: '5 MB' },
        { url: `${SERVER_URL}/data/10mb`, label: '10 MB' },
        // { url: `${SERVER_URL}/data/50mb`, label: '50 MB' },

        // JSON Data
        // { url: `${SERVER_URL}/json/small`, label: 'Small JSON' },
        { url: `${SERVER_URL}/json/medium`, label: 'Medium JSON' },
        { url: `${SERVER_URL}/json/large`, label: 'Large JSON' },
        { url: `${SERVER_URL}/json/xlarge`, label: 'XLarge JSON' },

        // Binary Data
        // { url: `${SERVER_URL}/binary/1kb`, label: 'Binary 1 KB' },
        // { url: `${SERVER_URL}/binary/100kb`, label: 'Binary 100 KB' },
        { url: `${SERVER_URL}/binary/1mb`, label: 'Binary 1 MB' },
        { url: `${SERVER_URL}/binary/5mb`, label: 'Binary 5 MB' },
        { url: `${SERVER_URL}/binary/10mb`, label: 'Binary 10 MB' },

        // Delay (but not streaming)
        // { url: `${SERVER_URL}/delay/500`, label: 'Delay 500ms' },
        // { url: `${SERVER_URL}/delay/1000`, label: 'Delay 1s' },
        // { url: `${SERVER_URL}/chunked`, label: 'Chunked Transfer' },
      ];

      for (const test of tests) {
        await runTest(test.url, test.label);
        // Small delay before next test
        await new Promise((resolve) => setTimeout(resolve, 200));
      }
    } finally {
      setTesting(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.buttonContainer}>
        <TouchableOpacity
          style={[styles.button, styles.runAllButton]}
          onPress={runAllTests}
          disabled={testing}
        >
          <Text style={styles.buttonText}>
            {testing ? '⏳ Running Tests...' : '🚀 Run All Tests'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.button,
            styles.cacheToggleButton,
            cacheEnabled && styles.cacheEnabledButton,
          ]}
          onPress={() => setCacheEnabled(!cacheEnabled)}
          disabled={testing}
        >
          <Text style={styles.buttonText}>
            {cacheEnabled ? '🔒 Cache ON' : '🔓 Cache OFF'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.cacheTestButton]}
          onPress={async () => {
            setTesting(true);
            try {
              const totalStart = performance.now();
              const times: number[] = [];
              let dataCount = 0;
              let savedRecordCount = 0;

              for (let i = 0; i < 15; i++) {
                const start = performance.now();
                let itemCount = 0;
                let totalRecordCount = 0;
                await fetchStreamedData({
                  onData: (data) => {
                    if ('records' in data && Array.isArray(data.records)) {
                      totalRecordCount += data.records.length;
                      console.log(
                        'Data:',
                        data,
                        `(${data.records.length} records)`
                      );
                    } else {
                      console.log('Data:', data);
                    }
                    itemCount++;
                  },
                });
                const end = performance.now();
                const duration = end - start;
                times.push(duration);
                if (i === 0) {
                  dataCount = itemCount;
                  savedRecordCount = totalRecordCount;
                }

                // Add each individual run to results
                const dataSizeText =
                  totalRecordCount > 0
                    ? `${totalRecordCount} records`
                    : `${itemCount} chunks`;
                const runResult: TestResult = {
                  endpoint: `🌊 Stream #${i + 1}`,
                  nativeDuration: 0,
                  nitroDuration: duration,
                  dataSize: dataSizeText,
                };
                setResults((prev) => [runResult, ...prev]);
              }

              const totalEnd = performance.now();
              const totalDuration = totalEnd - totalStart;
              const avgDuration = calculateRobustAverage(times);
              const minDuration = Math.min(...times);
              const maxDuration = Math.max(...times);

              // Add summary results to the UI
              const summaryDataSize =
                savedRecordCount > 0
                  ? `${savedRecordCount} records`
                  : `${dataCount} chunks`;
              const summaryResults: TestResult[] = [
                {
                  endpoint: '📊 Stream - Average',
                  nativeDuration: 0,
                  nitroDuration: avgDuration,
                  dataSize: summaryDataSize,
                },
                {
                  endpoint: '📊 Stream - Min',
                  nativeDuration: 0,
                  nitroDuration: minDuration,
                  dataSize: summaryDataSize,
                },
                {
                  endpoint: '📊 Stream - Max',
                  nativeDuration: 0,
                  nitroDuration: maxDuration,
                  dataSize: summaryDataSize,
                },
                {
                  endpoint: '📊 Stream - Total',
                  nativeDuration: 0,
                  nitroDuration: totalDuration,
                  dataSize: `15 runs`,
                },
              ];

              setResults((prev) => [...summaryResults, ...prev]);

              console.log('='.repeat(50));
              console.log(
                `Completed 15 stream tests in ${totalDuration.toFixed(2)}ms`
              );
              console.log(`Average: ${avgDuration.toFixed(2)}ms`);
              console.log(`Min: ${minDuration.toFixed(2)}ms`);
              console.log(`Max: ${maxDuration.toFixed(2)}ms`);
              console.log('='.repeat(50));
            } finally {
              setTesting(false);
            }
          }}
          disabled={testing}
        >
          <Text style={styles.buttonText}>🔍 Test Stream</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.button, styles.cacheTestButton]}
          onPress={async () => {
            setTesting(true);
            try {
              const testData = {
                message: 'Hello from React Native!',
                timestamp: Date.now(),
                data: Array.from({ length: 100 }, (_, i) => ({
                  id: i,
                  value: Math.random(),
                })),
              };
              const bodyString = JSON.stringify(testData);

              console.log(
                'Testing POST with body:',
                bodyString.length,
                'bytes'
              );

              // Test Native Fetch
              const nativeStart = performance.now();
              const nativeResponse = await fetch(`${SERVER_URL}/echo`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: bodyString,
              });
              const nativeData = await nativeResponse.json();
              const nativeDuration = performance.now() - nativeStart;

              console.log('Native POST Response:', nativeData);

              await new Promise((resolve) => setTimeout(resolve, 100));

              // Test Nitro Fetch
              const nitroStart = performance.now();
              const nitroResponse = await nitroFetch(`${SERVER_URL}/echo`, {
                method: 'POST',
                headers: {
                  'Content-Type': 'application/json',
                },
                body: bodyString,
              });
              const nitroData = await nitroResponse.json();
              const nitroDuration = performance.now() - nitroStart;

              console.log('Nitro POST Response:', nitroData);

              const result: TestResult = {
                endpoint: '📤 POST /echo',
                nativeDuration: nativeDuration,
                nitroDuration: nitroDuration,
                dataSize: `${bodyString.length}B`,
              };

              if (
                nativeData.success &&
                nitroData.success &&
                nativeData.receivedBytes === bodyString.length &&
                nitroData.receivedBytes === bodyString.length
              ) {
                console.log('✅ POST test successful!');
                setResults((prev) => [result, ...prev]);
              } else {
                console.error('❌ POST test failed');
                setResults((prev) => [
                  { ...result, error: 'Mismatch' },
                  ...prev,
                ]);
              }
            } catch (error: any) {
              console.error('❌ POST test error:', error);
              setResults((prev) => [
                {
                  endpoint: '📤 POST /echo',
                  nativeDuration: 0,
                  nitroDuration: 0,
                  dataSize: 'Error',
                  error: error.message,
                },
                ...prev,
              ]);
            } finally {
              setTesting(false);
            }
          }}
          disabled={testing}
        >
          <Text style={styles.buttonText}>📤 Test POST Body</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.resultsContainer}>
        <View style={styles.resultsHeader}>
          <View style={styles.resultsHeaderLeft}>
            <Text style={styles.resultsTitle}>
              Results - Avg of {TEST_ITERATIONS} runs{' '}
              {cacheEnabled ? '🔒' : '🔓'}
            </Text>
            {results.length > 0 &&
              !testing &&
              calculateAverageImprovement() !== null && (
                <Text style={styles.averageText}>
                  Avg: {calculateAverageImprovement()! > 0 ? '+' : ''}
                  {calculateAverageImprovement()!.toFixed(1)}% faster
                </Text>
              )}
          </View>
          {testing && <ActivityIndicator size="small" color="#007AFF" />}
        </View>

        <ScrollView style={styles.resultsList}>
          {results.length === 0 ? (
            <Text style={styles.emptyText}>
              No results yet. Tap "Run All Tests" to begin!
            </Text>
          ) : (
            <>
              {/* Table Header */}
              <View style={styles.tableHeader}>
                <Text
                  style={[
                    styles.tableCell,
                    styles.tableHeaderText,
                    styles.colTest,
                  ]}
                >
                  Test
                </Text>
                <Text
                  style={[
                    styles.tableCell,
                    styles.tableHeaderText,
                    styles.colSize,
                  ]}
                >
                  Size
                </Text>
                <Text
                  style={[
                    styles.tableCell,
                    styles.tableHeaderText,
                    styles.colNative,
                  ]}
                >
                  Native
                </Text>
                <Text
                  style={[
                    styles.tableCell,
                    styles.tableHeaderText,
                    styles.colNitro,
                  ]}
                >
                  Nitro
                </Text>
                <Text
                  style={[
                    styles.tableCell,
                    styles.tableHeaderText,
                    styles.colPrev,
                  ]}
                >
                  Prev
                </Text>
                <Text
                  style={[
                    styles.tableCell,
                    styles.tableHeaderText,
                    styles.colDiff,
                  ]}
                >
                  Diff
                </Text>
                <Text
                  style={[
                    styles.tableCell,
                    styles.tableHeaderText,
                    styles.colMatch,
                  ]}
                >
                  ✓
                </Text>
              </View>

              {/* Table Rows */}
              {results.map((result, index) => (
                <View key={index} style={styles.tableRow}>
                  {result.error ? (
                    <>
                      <Text
                        style={[styles.tableCell, styles.colTest]}
                        numberOfLines={1}
                      >
                        {result.endpoint}
                      </Text>
                      <Text
                        style={[
                          styles.tableCell,
                          styles.colSize,
                          styles.errorText,
                        ]}
                        numberOfLines={1}
                      >
                        Error
                      </Text>
                      <Text style={[styles.tableCell, styles.colNative]} />
                      <Text style={[styles.tableCell, styles.colNitro]} />
                      <Text style={[styles.tableCell, styles.colPrev]} />
                      <Text style={[styles.tableCell, styles.colDiff]} />
                      <Text style={[styles.tableCell, styles.colMatch]} />
                    </>
                  ) : (
                    <>
                      <Text
                        style={[styles.tableCell, styles.colTest]}
                        numberOfLines={1}
                      >
                        {result.endpoint}
                      </Text>
                      <Text
                        style={[styles.tableCell, styles.colSize]}
                        numberOfLines={1}
                      >
                        {result.dataSize}
                      </Text>
                      <Text
                        style={[styles.tableCell, styles.colNative]}
                        numberOfLines={1}
                      >
                        {result.nativeDuration.toFixed(0)}
                        {result.nativeCached ? '🟡' : ''}
                      </Text>
                      <Text
                        style={[
                          styles.tableCell,
                          styles.colNitro,
                          result.nitroDuration < result.nativeDuration &&
                            styles.winner,
                        ]}
                        numberOfLines={1}
                      >
                        {result.nitroDuration.toFixed(0)}
                        {result.nitroCached ? '🟡' : ''}
                      </Text>
                      <Text
                        style={[
                          styles.tableCell,
                          styles.colPrev,
                          result.prevBestNitro !== undefined &&
                            result.nitroDuration < result.prevBestNitro &&
                            styles.improved,
                        ]}
                        numberOfLines={1}
                      >
                        {result.prevBestNitro !== undefined
                          ? result.prevBestNitro.toFixed(0)
                          : '-'}
                      </Text>
                      <Text
                        style={[
                          styles.tableCell,
                          styles.colDiff,
                          result.nitroDuration < result.nativeDuration &&
                            styles.winner,
                        ]}
                        numberOfLines={1}
                      >
                        {result.nitroDuration < result.nativeDuration
                          ? `${((1 - result.nitroDuration / result.nativeDuration) * 100).toFixed(0)}%`
                          : `-${((result.nitroDuration / result.nativeDuration - 1) * 100).toFixed(0)}%`}
                      </Text>
                      <Text
                        style={[
                          styles.tableCell,
                          styles.colMatch,
                          result.dataMatch === true && styles.matchOk,
                          result.dataMatch === false && styles.matchFail,
                        ]}
                        numberOfLines={1}
                      >
                        {result.dataMatch === true
                          ? '✅'
                          : result.dataMatch === false
                            ? '❌'
                            : '-'}
                      </Text>
                    </>
                  )}
                </View>
              ))}
            </>
          )}
        </ScrollView>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    paddingTop: 36,
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    textAlign: 'center',
    marginBottom: 4,
    color: '#333',
  },
  subtitle: {
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 12,
    color: '#666',
  },
  buttonContainer: {
    paddingHorizontal: 16,
    paddingBottom: 12,
  },
  button: {
    backgroundColor: '#007AFF',
    padding: 14,
    borderRadius: 8,
    marginBottom: 8,
  },
  runAllButton: {
    backgroundColor: '#34C759',
  },
  cacheToggleButton: {
    backgroundColor: '#5856D6',
  },
  cacheEnabledButton: {
    backgroundColor: '#FF9500',
  },
  cacheTestButton: {
    backgroundColor: '#AF52DE',
  },
  clearButton: {
    backgroundColor: '#FF3B30',
  },
  buttonText: {
    color: '#fff',
    textAlign: 'center',
    fontSize: 15,
    fontWeight: '600',
  },
  resultsContainer: {
    flex: 1,
    borderTopWidth: 2,
    borderTopColor: '#ddd',
    backgroundColor: '#fff',
  },
  resultsHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  resultsHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  resultsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  averageText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#34C759',
    backgroundColor: '#E8F5E9',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  resultsList: {
    flex: 1,
  },
  emptyText: {
    textAlign: 'center',
    color: '#999',
    marginTop: 40,
    fontSize: 14,
  },
  // Table styles
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#f0f0f0',
    borderBottomWidth: 2,
    borderBottomColor: '#ddd',
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  tableHeaderText: {
    fontWeight: '700',
    fontSize: 11,
    color: '#333',
  },
  tableRow: {
    flexDirection: 'row',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
    paddingVertical: 6,
    paddingHorizontal: 8,
    backgroundColor: '#fff',
  },
  tableCell: {
    fontSize: 11,
    color: '#333',
    paddingHorizontal: 4,
  },
  // Column widths
  colTest: {
    flex: 2.2,
  },
  colSize: {
    flex: 1.3,
    textAlign: 'right',
  },
  colNative: {
    flex: 1.1,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  colNitro: {
    flex: 1.1,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  colPrev: {
    flex: 1,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  colDiff: {
    flex: 0.9,
    textAlign: 'right',
    fontVariant: ['tabular-nums'],
  },
  colMatch: {
    flex: 0.6,
    textAlign: 'center',
  },
  winner: {
    color: '#34C759',
    fontWeight: '700',
  },
  improved: {
    color: '#2196F3',
    fontWeight: '700',
  },
  matchOk: {
    color: '#34C759',
  },
  matchFail: {
    color: '#FF3B30',
  },
  errorText: {
    color: '#FF3B30',
    fontSize: 11,
  },
});
