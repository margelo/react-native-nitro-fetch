// Web override for blob.ts. The browser's Blob accepts an ArrayBuffer directly and
// is binary-safe, so there's no native blob registry to reach. This avoids pulling
// react-native internals (react-native/Libraries/Blob/BlobManager — Flow source web
// bundlers can't parse — and TurboModuleRegistry, absent from react-native-web) into
// the web bundle. Resolved over blob.ts on web via the `.web` platform extension.
export function bytesToBlob(bytes: ArrayBuffer, type: string): Blob {
  return new Blob([bytes], { type });
}
