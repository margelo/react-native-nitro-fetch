declare const global: {
  HermesInternal?: {
    enableSamplingProfiler(): void;
    disableSamplingProfiler(): void;
    dumpSamplingProfiler(filename: string): void;
  };
};

/** What {@link profileFetch} returns. */
export interface ProfileResult<T> {
  /** What `fn` returned. */
  result: T;
  /** Where the profile is written. Not set without Hermes, and the file is missing if writing failed. */
  profilePath?: string;
}

/** Runs `fn` with the Hermes sampling profiler on and saves a `.cpuprofile` file. Without Hermes it just runs `fn`. */
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
