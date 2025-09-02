import type { HybridObject } from 'react-native-nitro-modules';

export interface NitroEnv
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  // Absolute path to app-specific cache directory
  getCacheDir(): string;
}

