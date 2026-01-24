import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import { TextDecoder as NitroTextDecoder } from 'react-native-nitro-fetch';
import FastTextEncoder from 'react-native-fast-encoder';
import 'fast-text-encoding';

interface SpeedTestResult {
  name: string;
  duration: number;
  size: number;
}

interface SmallTestResult {
  name: string;
  duration: number;
}

const WARMUP_RUNS = 3;
const TEST_RUNS = 10;

// Helper function to run a test multiple times and get median
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
  return times[Math.floor(times.length / 2)]!;
};

export default function SpeedTest() {
  const [largeTestResults, setLargeTestResults] = useState<SpeedTestResult[] | null>(null);
  const [smallTestResults, setSmallTestResults] = useState<SmallTestResult[] | null>(null);
  const [runningLarge, setRunningLarge] = useState(false);
  const [runningSmall, setRunningSmall] = useState(false);

  const runLargeTest = async () => {
    setLargeTestResults(null);
    setRunningLarge(true);

    // Use setTimeout to let UI update
    setTimeout(() => {
      try {
        const speedResults: SpeedTestResult[] = [];

        // Create a large text to encode (~10MB of repeated text)
        const testText =
          'Hello, World! Testing UTF-8 encoding with emoji! '.repeat(200000);
        const encoder = new TextEncoder();
        const encoded = encoder.encode(testText);

        // Test 1: Nitro TextDecoder (no stream)
        const duration1 = runTest(() => {
          const decoder = new NitroTextDecoder('utf-8');
          decoder.decode(encoded);
        });
        speedResults.push({
          name: 'Nitro TextDecoder (no stream)',
          duration: duration1,
          size: encoded.byteLength,
        });

        // Test 2: Nitro TextDecoder (stream=true)
        const duration2 = runTest(() => {
          const decoder = new NitroTextDecoder('utf-8');
          decoder.decode(encoded, { stream: true });
        });
        speedResults.push({
          name: 'Nitro TextDecoder (stream=true)',
          duration: duration2,
          size: encoded.byteLength,
        });

        // Test 3: react-native-fast-encoder (no stream)
        const duration3 = runTest(() => {
          const decoder = new FastTextEncoder();
          decoder.decode(encoded);
        });
        speedResults.push({
          name: 'react-native-fast-encoder (no stream)',
          duration: duration3,
          size: encoded.byteLength,
        });

        // Test 4: react-native-fast-encoder (stream=true)
        const duration4 = runTest(() => {
          const decoder = new FastTextEncoder();
          decoder.decode(encoded, { stream: true });
        });
        speedResults.push({
          name: 'react-native-fast-encoder (stream=true)',
          duration: duration4,
          size: encoded.byteLength,
        });

        // Test 5: Polyfill TextDecoder (from fast-text-encoding)
        const duration5 = runTest(() => {
          const decoder = new TextDecoder('utf-8');
          decoder.decode(encoded);
        });
        speedResults.push({
          name: 'Polyfill TextDecoder',
          duration: duration5,
          size: encoded.byteLength,
        });

        setLargeTestResults(speedResults);
      } catch (error) {
        console.error('Large test error:', error);
      } finally {
        setRunningLarge(false);
      }
    }, 100);
  };

  const runSmallTest = async () => {
    setSmallTestResults(null);
    setRunningSmall(true);

    setTimeout(() => {
      try {
        const testResults: SmallTestResult[] = [];
        const helloBytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
        const iterations = 50000;

        // Test 1: Nitro TextDecoder
        const nitroDecoder = new NitroTextDecoder();
        const start1 = performance.now();
        for (let i = 0; i < iterations; i++) {
          nitroDecoder.decode(helloBytes);
        }
        const duration1 = performance.now() - start1;
        testResults.push({ name: 'Nitro TextDecoder', duration: duration1 });
        console.log(`Nitro TextDecoder: ${duration1.toFixed(2)} milliseconds`);

        // Test 2: react-native-fast-encoder
        const fastDecoder = new FastTextEncoder();
        const start2 = performance.now();
        for (let i = 0; i < iterations; i++) {
          fastDecoder.decode(helloBytes);
        }
        const duration2 = performance.now() - start2;
        testResults.push({
          name: 'react-native-fast-encoder',
          duration: duration2,
        });
        console.log(
          `react-native-fast-encoder: ${duration2.toFixed(2)} milliseconds`
        );

        // Test 3: Polyfill TextDecoder (from fast-text-encoding)
        const polyfillDecoder = new TextDecoder();
        const start3 = performance.now();
        for (let i = 0; i < iterations; i++) {
          polyfillDecoder.decode(helloBytes);
        }
        const duration3 = performance.now() - start3;
        testResults.push({ name: 'Polyfill TextDecoder', duration: duration3 });
        console.log(`Polyfill TextDecoder: ${duration3.toFixed(2)} milliseconds`);

        setSmallTestResults(testResults);
      } catch (error) {
        console.error('Small test error:', error);
      } finally {
        setRunningSmall(false);
      }
    }, 100);
  };

  const getFastestIndex = (results: { duration: number }[]) => {
    let minIndex = 0;
    let minDuration = results[0]?.duration ?? Infinity;
    results.forEach((r, i) => {
      if (r.duration < minDuration) {
        minDuration = r.duration;
        minIndex = i;
      }
    });
    return minIndex;
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Large Data Test (~10MB)</Text>
        <Text style={styles.sectionDescription}>
          Decodes ~10MB of UTF-8 text. Runs {TEST_RUNS} times, reports median.
        </Text>
        <TouchableOpacity
          style={[styles.button, runningLarge && styles.buttonDisabled]}
          onPress={runLargeTest}
          disabled={runningLarge}
        >
          {runningLarge ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Run Large Data Test</Text>
          )}
        </TouchableOpacity>

        {largeTestResults && (
          <View style={styles.resultsContainer}>
            <Text style={styles.resultsTitle}>Results:</Text>
            <Text style={styles.dataSize}>
              Data size: {(largeTestResults[0]!.size / 1024 / 1024).toFixed(2)} MB
            </Text>
            {largeTestResults.map((result, index) => {
              const fastest = getFastestIndex(largeTestResults) === index;
              return (
                <View
                  key={index}
                  style={[styles.resultRow, fastest && styles.resultFastest]}
                >
                  <Text
                    style={[styles.resultName, fastest && styles.resultFastestText]}
                  >
                    {result.name} {fastest && ' '}
                  </Text>
                  <Text
                    style={[
                      styles.resultDuration,
                      fastest && styles.resultFastestText,
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

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Small Data Test (50k iterations)</Text>
        <Text style={styles.sectionDescription}>
          Decodes "Hello" (5 bytes) 50,000 times. Tests decoder overhead.
        </Text>
        <TouchableOpacity
          style={[styles.button, styles.buttonSecondary, runningSmall && styles.buttonDisabled]}
          onPress={runSmallTest}
          disabled={runningSmall}
        >
          {runningSmall ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <Text style={styles.buttonText}>Run Small Data Test</Text>
          )}
        </TouchableOpacity>

        {smallTestResults && (
          <View style={styles.resultsContainer}>
            <Text style={styles.resultsTitle}>Results (50k iterations):</Text>
            {smallTestResults.map((result, index) => {
              const fastest = getFastestIndex(smallTestResults) === index;
              return (
                <View
                  key={index}
                  style={[styles.resultRow, fastest && styles.resultFastest]}
                >
                  <Text
                    style={[styles.resultName, fastest && styles.resultFastestText]}
                  >
                    {result.name} {fastest && ' '}
                  </Text>
                  <Text
                    style={[
                      styles.resultDuration,
                      fastest && styles.resultFastestText,
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  section: {
    backgroundColor: '#fff',
    margin: 16,
    marginBottom: 8,
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
  },
  sectionDescription: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
    lineHeight: 20,
  },
  button: {
    backgroundColor: '#2196F3',
    paddingVertical: 14,
    paddingHorizontal: 24,
    borderRadius: 8,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 48,
  },
  buttonSecondary: {
    backgroundColor: '#4CAF50',
  },
  buttonDisabled: {
    backgroundColor: '#bbb',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  resultsContainer: {
    marginTop: 16,
    padding: 12,
    backgroundColor: '#f8f8f8',
    borderRadius: 8,
  },
  resultsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  dataSize: {
    fontSize: 13,
    color: '#666',
    marginBottom: 12,
  },
  resultRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: 6,
    marginBottom: 6,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#eee',
  },
  resultFastest: {
    backgroundColor: '#e8f5e9',
    borderColor: '#4CAF50',
    borderLeftWidth: 4,
  },
  resultName: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
    flex: 1,
  },
  resultDuration: {
    fontSize: 14,
    fontWeight: '600',
    color: '#2196F3',
  },
  resultFastestText: {
    color: '#2E7D32',
    fontWeight: '700',
  },
});
