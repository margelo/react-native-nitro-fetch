import type { HybridObject } from 'react-native-nitro-modules';

export interface NativeStorage
  extends HybridObject<{ ios: 'swift'; android: 'kotlin' }> {
  getString(key: string): string;
  setString(key: string, value: string): void;
  removeString(key: string): void;
}
