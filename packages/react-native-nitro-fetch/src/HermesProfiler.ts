declare const global: {
  HermesInternal?: {
    enableSamplingProfiler(): void;
    disableSamplingProfiler(): void;
    dumpSamplingProfiler(filename: string): void;
  };
};

export interface ProfileResult<T> {
  result: T;
  profilePath?: string;
}

export async function profileFetch<T>(
  fn: () => Promise<T>,
  outputPath?: string
): Promise<ProfileResult<T>> {
  const hermes = global.HermesInternal;
  if (!hermes) {
    const result = await fn();
    return { result };
  }

  const path = outputPath ?? `/tmp/nitrofetch-profile-${Date.now()}.cpuprofile`;
  hermes.enableSamplingProfiler();
  try {
    const result = await fn();
    return { result, profilePath: path };
  } finally {
    hermes.disableSamplingProfiler();
    try {
      hermes.dumpSamplingProfiler(path);
    } catch {
      // Profile dump may fail on some platforms
    }
  }
}
