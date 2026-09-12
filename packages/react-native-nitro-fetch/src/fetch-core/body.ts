import type { NitroFormDataPart } from '../NitroFetch.nitro';
import { NitroRequest as NitroRequestClass, rawBodyOf } from '../Request';
import {
  TEXT_CONTENT_TYPE,
  FORM_CONTENT_TYPE,
  BYTES_CONTENT_TYPE,
  headersToPairs,
} from './headers';

// A view spanning its whole buffer needs no copy.
function viewToBuffer(view: ArrayBufferView): ArrayBuffer {
  'worklet';
  const buf = view.buffer as ArrayBuffer;
  if (view.byteOffset === 0 && view.byteLength === buf.byteLength) return buf;
  return buf.slice(view.byteOffset, view.byteOffset + view.byteLength);
}

export function serializeFormData(fd: FormData): NitroFormDataPart[] {
  const parts: NitroFormDataPart[] = [];

  if (typeof (fd as any).getParts === 'function') {
    const rnParts: any[] = (fd as any).getParts();
    for (const part of rnParts) {
      if (part.string !== undefined) {
        parts.push({ name: part.fieldName, value: String(part.string) });
      } else if (part.uri) {
        parts.push({
          name: part.fieldName,
          fileUri: part.uri,
          fileName: part.fileName ?? part.name ?? 'file',
          mimeType: part.type ?? 'application/octet-stream',
        });
      }
    }
    return parts;
  }

  fd.forEach((value: any, key: string) => {
    if (typeof value === 'string') {
      parts.push({ name: key, value });
    } else if (value && typeof value === 'object') {
      parts.push({
        name: key,
        fileUri: value.uri ?? value.fileUri,
        fileName: value.name ?? value.fileName ?? 'file',
        mimeType: value.type ?? value.mimeType ?? 'application/octet-stream',
      });
    }
  });
  return parts;
}

export function isFormData(body: unknown): body is FormData {
  if (typeof FormData !== 'undefined' && body instanceof FormData) return true;
  if (
    body &&
    typeof body === 'object' &&
    typeof (body as any).append === 'function' &&
    typeof (body as any).getParts === 'function'
  ) {
    return true;
  }
  return false;
}

export function normalizeBody(body: BodyInit | null | undefined):
  | {
      bodyString?: string;
      bodyBytes?: ArrayBuffer;
      bodyFormData?: NitroFormDataPart[];
      contentType?: string;
    }
  | undefined {
  'worklet';
  if (body == null) return undefined;
  if (typeof body === 'string')
    return { bodyString: body, contentType: TEXT_CONTENT_TYPE };

  if (isFormData(body)) {
    return { bodyFormData: serializeFormData(body as FormData) };
  }
  if (body instanceof URLSearchParams)
    return { bodyString: body.toString(), contentType: FORM_CONTENT_TYPE };
  if (typeof ArrayBuffer !== 'undefined' && body instanceof ArrayBuffer)
    return { bodyBytes: body, contentType: BYTES_CONTENT_TYPE };
  if (ArrayBuffer.isView(body)) {
    return { bodyBytes: viewToBuffer(body), contentType: BYTES_CONTENT_TYPE };
  }
  throw new Error('Unsupported body type for nitro fetch');
}

// Pure JS version of buildNitroRequest that doesnt use anything that breaks worklets
export function normalizeBodyPure(
  body: BodyInit | null | undefined
):
  | { bodyString?: string; bodyBytes?: ArrayBuffer; contentType?: string }
  | undefined {
  'worklet';
  if (body == null) return undefined;
  if (typeof body === 'string')
    return { bodyString: body, contentType: TEXT_CONTENT_TYPE };

  // Check for URLSearchParams (duck typing)
  // It should be an object, have a toString method, and typically append/delete methods
  // But mainly we care about toString() returning the query string
  if (
    typeof body === 'object' &&
    body !== null &&
    typeof (body as any).toString === 'function' &&
    Object.prototype.toString.call(body) === '[object URLSearchParams]'
  ) {
    return { bodyString: body.toString(), contentType: FORM_CONTENT_TYPE };
  }

  // Check for ArrayBuffer (using toString tag to avoid instanceof)
  if (
    typeof ArrayBuffer !== 'undefined' &&
    Object.prototype.toString.call(body) === '[object ArrayBuffer]'
  ) {
    return { bodyBytes: body as ArrayBuffer, contentType: BYTES_CONTENT_TYPE };
  }

  if (ArrayBuffer.isView(body)) {
    return { bodyBytes: viewToBuffer(body), contentType: BYTES_CONTENT_TYPE };
  }
  throw new Error(
    'Unsupported body type for nitro fetch worklet (FormData is not available in worklets)'
  );
}

export async function resolveRequestBody(
  input: RequestInfo | URL,
  init: RequestInit | undefined
): Promise<RequestInit | undefined> {
  if (typeof input === 'string' || input instanceof URL) return init;
  if (input instanceof NitroRequestClass) {
    const raw = rawBodyOf(input);
    if (init?.body == null && raw != null)
      return {
        ...(init ?? {}),
        headers: init?.headers ?? (input.headers as any),
        body: raw,
      };
    return init;
  }
  if (init?.body != null) return init;
  const req = input as Request;
  if (typeof req.clone !== 'function') return init;
  const method = (init?.method ?? req.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') return init;
  try {
    // whatwg-fetch keeps the original BodyInit here; only bytes need the lossless read.
    const raw = (req as { _bodyInit?: unknown })._bodyInit;
    const isBinary =
      (typeof Blob !== 'undefined' && raw instanceof Blob) ||
      (typeof ArrayBuffer !== 'undefined' && raw instanceof ArrayBuffer) ||
      ArrayBuffer.isView(raw);
    if (isBinary && typeof req.arrayBuffer === 'function') {
      const bytes = await req.clone().arrayBuffer();
      if (bytes.byteLength === 0) return init;
      return { ...(init ?? {}), body: bytes };
    }
    const text = await req.clone().text();
    if (text.length === 0) return init;
    return { ...(init ?? {}), body: text };
  } catch {
    return init;
  }
}

export async function resolveBlobBody(
  init: RequestInit | undefined
): Promise<RequestInit | undefined> {
  if (!init?.body) return init;
  if (typeof Blob !== 'undefined' && init.body instanceof Blob) {
    const blob = init.body as Blob;
    const bytes = await new Promise<ArrayBuffer>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error);
      reader.readAsArrayBuffer(blob);
    });
    // Auto-set Content-Type from Blob.type if not already provided
    let headers = init.headers;
    if (blob.type) {
      const pairs = headersToPairs(headers) ?? [];
      const hasContentType = pairs.some(
        (h) => h.key.toLowerCase() === 'content-type'
      );
      if (!hasContentType) {
        pairs.push({ key: 'Content-Type', value: blob.type });
        headers = pairs.map((h) => [h.key, h.value] as [string, string]);
      }
    }
    return { ...init, body: bytes, headers };
  }
  return init;
}
