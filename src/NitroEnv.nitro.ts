import type { HybridObject } from 'react-native-nitro-modules';

export interface NitroEnv
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  // Absolute path to app-specific cache directory
  getCacheDir(): string;

  // Initialize Cronet via platform APIs and adopt the native engine in C++.
  // Returns true if the engine was created/adopted successfully.
  // On Android, this builds a CronetEngine on the main thread and passes its native pointer to C++.
  createCronetEngine(cacheDir?: string): boolean;
}
