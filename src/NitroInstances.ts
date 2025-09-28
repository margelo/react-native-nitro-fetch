import { NitroModules } from 'react-native-nitro-modules';
import type { NitroFetch as NitroFetchType } from './NitroFetch.nitro';

// Create singletons once per JS runtime
export const NitroFetch: NitroFetchType =
  NitroModules.createHybridObject<NitroFetchType>('NitroFetch');


export const boxedNitroFetch = NitroModules.box(NitroFetch);