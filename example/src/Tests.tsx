import React from 'react';
import { useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

import './tests/custom';
import './tests/web';
import type { TestResult, TestResults } from './types';
import { TestsContext } from './utils';
import { fetchStreamedData } from './stream';

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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Quick Crypto Tests</Text>

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
});
