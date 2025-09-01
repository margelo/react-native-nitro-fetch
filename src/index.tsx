import { NitroModules } from 'react-native-nitro-modules';
import type { NitroFetch } from './NitroFetch.nitro';

const NitroFetchHybridObject =
  NitroModules.createHybridObject<NitroFetch>('NitroFetch');

export function multiply(a: number, b: number): number {
  return NitroFetchHybridObject.multiply(a, b);
}
