interface SamplingProfiler {
  enableSamplingProfiler(): void;
  disableSamplingProfiler(): void;
  dumpSamplingProfiler(filename: string): void;
}

let profiling = false;

export interface ProfileResult<T> {
  result: T;
  profilePath?: string;
}

export async function profileFetch<T>(
  fn: () => Promise<T>,
  outputPath?: string
): Promise<ProfileResult<T>> {
  const hermes = (
    globalThis as typeof globalThis & {
      HermesInternal?: Partial<SamplingProfiler>;
    }
  ).HermesInternal;
  if (
    profiling ||
    typeof hermes?.enableSamplingProfiler !== 'function' ||
    typeof hermes.disableSamplingProfiler !== 'function' ||
    typeof hermes.dumpSamplingProfiler !== 'function'
  ) {
    const result = await fn();
    return { result };
  }

  const path = outputPath ?? `/tmp/nitrofetch-profile-${Date.now()}.cpuprofile`;
  try {
    hermes.enableSamplingProfiler();
  } catch {
    return { result: await fn() };
  }
  profiling = true;
  let result: T;
  let profilePath: string | undefined;
  try {
    result = await fn();
  } finally {
    try {
      hermes.disableSamplingProfiler();
      hermes.dumpSamplingProfiler(path);
      profilePath = path;
    } catch {
      // Diagnostics must not change the wrapped function's result or error.
    } finally {
      profiling = false;
    }
  }
  return profilePath ? { result, profilePath } : { result };
}
