import { NitroModules } from 'react-native-nitro-modules';
import type { NitroFetch as NitroFetchType } from './NitroFetch.nitro';
import type { NitroEnv as NitroEnvType } from './NitroEnv.nitro';

// Create singletons once per JS runtime
export const NitroFetch: NitroFetchType =
  NitroModules.createHybridObject<NitroFetchType>('NitroFetch');

export const NitroEnv: NitroEnvType =
  NitroModules.createHybridObject<NitroEnvType>('NitroEnv');

