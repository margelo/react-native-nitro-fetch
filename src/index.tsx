import 'web-streams-polyfill/polyfill';
export * from './TextDecoder';
export * from './fetch';
// Keep legacy export to avoid breaking any local tests/usages during scaffolding.
// Will be removed once native Cronet path is ready.
export function multiply(a: number, b: number): number {
  return a * b;
}
