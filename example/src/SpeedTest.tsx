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

        // Create all decoders upfront
        const nitroDecoder = new NitroTextDecoder('utf-8');
        const fastDecoder = new FastTextEncoder();
        const polyfillDecoder = new TextDecoder('utf-8');

        // Warmup ALL decoders first (JIT compilation, prototype init, etc.)
        console.log('Warming up all decoders with large data...');
        for (let i = 0; i < WARMUP_RUNS; i++) {
          nitroDecoder.decode(encoded);
          nitroDecoder.decode(encoded, { stream: true });
          fastDecoder.decode(encoded);
          fastDecoder.decode(encoded, { stream: true });
          polyfillDecoder.decode(encoded);
        }
        console.log('Warmup complete, starting measurements...');

        // Measured runs - take median of TEST_RUNS
        const runMeasurement = (name: string, fn: () => void): number => {
          const times: number[] = [];
          for (let i = 0; i < TEST_RUNS; i++) {
            const start = performance.now();
            fn();
            times.push(performance.now() - start);
          }
          times.sort((a, b) => a - b);
          const median = times[Math.floor(times.length / 2)]!;
          console.log(`${name}: ${median.toFixed(2)}ms`);
          return median;
        };

        // Run Polyfill first - it's pure JS and "absorbs" cache warming overhead
        // Test 1: Polyfill TextDecoder
        const duration1 = runMeasurement('Polyfill', () => {
          polyfillDecoder.decode(encoded);
        });
        speedResults.push({
          name: 'Polyfill',
          duration: duration1,
          size: encoded.byteLength,
        });

        // Test 2: FastEncoder (no stream)
        const duration2 = runMeasurement('FastEncoder (no stream)', () => {
          fastDecoder.decode(encoded);
        });
        speedResults.push({
          name: 'FastEncoder (no stream)',
          duration: duration2,
          size: encoded.byteLength,
        });

        // Test 3: FastEncoder (stream=true)
        const duration3 = runMeasurement('FastEncoder (stream)', () => {
          fastDecoder.decode(encoded, { stream: true });
        });
        speedResults.push({
          name: 'FastEncoder (stream)',
          duration: duration3,
          size: encoded.byteLength,
        });

        // Test 4: Nitro TextDecoder (no stream)
        const duration4 = runMeasurement('Nitro (no stream)', () => {
          nitroDecoder.decode(encoded);
        });
        speedResults.push({
          name: 'Nitro (no stream)',
          duration: duration4,
          size: encoded.byteLength,
        });

        // Test 5: Nitro TextDecoder (stream=true)
        const duration5 = runMeasurement('Nitro (stream)', () => {
          nitroDecoder.decode(encoded, { stream: true });
        });
        speedResults.push({
          name: 'Nitro (stream)',
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

    // Helper to run a single test with warmup
    const runSingleTest = (
      name: string,
      testFn: () => void,
      iterations: number
    ): number => {
      // Warmup runs (5 iterations to trigger JIT)
      for (let i = 0; i < 5; i++) {
        testFn();
      }

      // Actual measured run
      const start = performance.now();
      for (let i = 0; i < iterations; i++) {
        testFn();
      }
      const duration = performance.now() - start;
      console.log(`${name}: ${duration.toFixed(2)} milliseconds`);
      return duration;
    };

    // Run tests with delays between them to allow GC
    setTimeout(() => {
      try {
        const testResults: SmallTestResult[] = [];
        const helloBytes = new Uint8Array([72, 101, 108, 108, 111]); // "Hello"
        const iterations = 50000;
        const warmupIterations = 1000;

        // Create all decoders
        const nitroDecoder = new NitroTextDecoder();
        const fastDecoder = new FastTextEncoder();
        const polyfillDecoder = new TextDecoder();

        // Warmup ALL decoders first (JIT compilation, prototype init, etc.)
        console.log('Warming up all decoders...');
        for (let i = 0; i < warmupIterations; i++) {
          nitroDecoder.decode(helloBytes);
          fastDecoder.decode(helloBytes);
          polyfillDecoder.decode(helloBytes);
        }
        console.log('Warmup complete, starting measurements...');

        // Test 1: Polyfill TextDecoder (run first)
        const start1 = performance.now();
        for (let i = 0; i < iterations; i++) {
          polyfillDecoder.decode(helloBytes);
        }
        const duration1 = performance.now() - start1;
        testResults.push({ name: 'Polyfill', duration: duration1 });
        console.log(`Polyfill: ${duration1.toFixed(2)}ms`);

        // Test 2: FastEncoder
        const start2 = performance.now();
        for (let i = 0; i < iterations; i++) {
          fastDecoder.decode(helloBytes);
        }
        const duration2 = performance.now() - start2;
        testResults.push({ name: 'FastEncoder', duration: duration2 });
        console.log(`FastEncoder: ${duration2.toFixed(2)}ms`);

        // Test 3: Nitro TextDecoder (run last)
        const start3 = performance.now();
        for (let i = 0; i < iterations; i++) {
          nitroDecoder.decode(helloBytes);
        }
        const duration3 = performance.now() - start3;
        testResults.push({ name: 'Nitro TextDecoder', duration: duration3 });
        console.log(`Nitro TextDecoder: ${duration3.toFixed(2)}ms`);

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
