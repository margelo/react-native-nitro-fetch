/* eslint-disable no-bitwise */
/**
 * Create a React Native Blob from raw bytes without passing binary data through
 * JS strings (RN BlobModule.createFromParts truncates at \0 over the bridge).
 */

function uuidv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function bytesToBase64(bytes: Uint8Array): string {
  const chunkSize = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk as unknown as number[]);
  }
  return btoa(binary);
}

function tryArrayBufferBlob(bytes: ArrayBuffer, type: string): Blob | null {
  if (typeof Blob === 'undefined') return null;
  try {
    const blob = new Blob([bytes], { type });
    if (blob.size === bytes.byteLength) {
      return blob;
    }
  } catch {
    // RN core Blob rejects ArrayBuffer / ArrayBufferView.
  }
  return null;
}

export async function createBlobFromBytes(
  bytes: ArrayBuffer,
  type = ''
): Promise<Blob> {
  const fromArrayBuffer = tryArrayBufferBlob(bytes, type);
  if (fromArrayBuffer) {
    return fromArrayBuffer;
  }

  const BlobManager =
    require('react-native/Libraries/Blob/BlobManager').default;

  const { NativeModules } = require('react-native');

  const store = NativeModules.NitroFetchBlobStore;
  if (!store?.storeBase64) {
    throw new TypeError(
      'NitroFetch cannot create a binary Blob: react-native Blob does not support ' +
        'ArrayBuffer and NitroFetchBlobStore is unavailable. Use response.arrayBuffer() ' +
        'instead of blob(), or pass a { uri, name, type } object for local files.'
    );
  }

  const blobId = uuidv4();
  const base64 = bytesToBase64(new Uint8Array(bytes));
  await store.storeBase64(base64, blobId);

  return BlobManager.createFromOptions({
    blobId,
    offset: 0,
    size: bytes.byteLength,
    type,
    lastModified: Date.now(),
  });
}
