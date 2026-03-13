import { NitroModules } from 'react-native-nitro-modules';
import type { NativeStorage as NativeStorageType } from './NativeStorage.nitro';

// Create singletons once per JS runtime
export const NativeStorage: NativeStorageType =
  NitroModules.createHybridObject<NativeStorageType>('NativeStorage');
