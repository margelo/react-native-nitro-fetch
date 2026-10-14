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
  if (
    typeof hermes?.enableSamplingProfiler !== 'function' ||
    typeof hermes.disableSamplingProfiler !== 'function' ||
    typeof hermes.dumpSamplingProfiler !== 'function'
  ) {
    const result = await fn();
    return { result };
  }

  const path = outputPath ?? `/tmp/nitrofetch-profile-${Date.now()}.cpuprofile`;
  hermes.enableSamplingProfiler();
  let profilePath: string | undefined;
  let result: T;
  try {
    result = await fn();
  } finally {
    hermes.disableSamplingProfiler();
    try {
      hermes.dumpSamplingProfiler(path);
      profilePath = path;
    } catch {}
  }
  return profilePath ? { result, profilePath } : { result };
}
