export { nitroFetch as fetch, nitroFetchOnWorklet } from './fetch';
export type { NitroRequest, NitroResponse, NitroEnv } from './fetch';
export { NitroFetch, NitroEnv as NitroEnvInstance } from './NitroInstances';

// Keep legacy export to avoid breaking any local tests/usages during scaffolding.
// Will be removed once native Cronet path is ready.
export function multiply(a: number, b: number): number {
  return a * b;
}
