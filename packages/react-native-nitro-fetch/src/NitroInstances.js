import { NitroModules } from 'react-native-nitro-modules';
// Create singletons once per JS runtime
export const NitroFetch = NitroModules.createHybridObject('NitroFetch');
export const NativeStorage = NitroModules.createHybridObject('NativeStorage');
export const boxedNitroFetch = NitroModules.box(NitroFetch);
export const NitroCronetSingleton =
  NitroModules.createHybridObject('NitroCronet');
