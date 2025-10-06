export type SuiteResults<T = TestResult> = {
  [key: string]: SuiteResult<T>;
};

export type SuiteResult<T> = {
  results: T[];
};

export type TestResult = {
  type: 'correct' | 'incorrect' | 'grouping';
  description: string;
  errorMsg?: string;
  indentation: number;
  suiteName: string;
};

export type Stats = {
  start: Date;
  end: Date;
  duration: number;
  suites: number;
  tests: number;
  passes: number;
  pending: number;
  failures: number;
};

export interface TestResults {
  [suiteName: string]: {
    results: TestResult[];
  };
}

export type TestSuites = {
  [key: string]: TestSuite;
};

export interface TestSuite {
  value: boolean;
  tests: Tests;
}

export interface Tests {
  [key: string]: () => void | Promise<void>;
}
