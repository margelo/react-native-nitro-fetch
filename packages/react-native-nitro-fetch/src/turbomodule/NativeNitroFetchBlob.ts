import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

// Tiny TurboModule whose only job is to reach RN's native BlobModule from a place
// RN decorates with `moduleRegistry` — so we don't have to patch nitro-modules.
export interface Spec extends TurboModule {
  // base64-encoded bytes -> RCTBlobManager/BlobModule blobId ("" on failure).
  createBlobId(base64: string): string;
}

export default TurboModuleRegistry.get<Spec>('NitroFetchBlob');
