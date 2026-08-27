# Fetch compatibility corrections

These corrections preserve the native transport API, but applications relying on the previous permissive behavior should check the following changes:

- Request and Response body readers consume the actual body, including Blob and ReadableStream inputs. Reusing a consumed or locked body rejects instead of returning empty data. Clone before reading when two consumers need the body. Empty JSON rejects with `SyntaxError`; an empty body is not JSON `null`.
- Constructing a Request from another Request transfers its body. `clone()` keeps both copies readable. GET and HEAD bodies are rejected, including when a method override would otherwise silently discard an existing body.
- Public Response construction validates the status, status text, and bodyless statuses. `Response.json(undefined)` rejects. String bodies get the default `text/plain;charset=UTF-8` content type. Native FormData uploads remain supported, but serializing FormData through Nitro Request body readers or the Nitro Response constructor is unsupported and now rejects explicitly.
- HTTP response bytes are preserved when they are not valid UTF-8. `text()` and `json()` use UTF-8 decoding, not the response charset parameter. Use `arrayBuffer()` and a decoder for a different encoding when needed. Non-empty conversions without an available UTF-8 codec reject rather than silently returning empty data; install the required global codec polyfill before converting bodies.
- `data:` URLs preserve percent-encoded binary bytes, percent-decode base64 input, and exclude URL fragments from the body.
- RequestInit overrides and inherited AbortSignals are honored. HTTP aborts reject even while the native request is joining a prefetch. The web/no-native adapters preserve Request options and let platform fetch consume standard Request inputs once. They still return non-2xx HTTP responses normally.
- Streaming redirect `follow`, `manual`, and `error` modes are handled explicitly. Native manual mode exposes the 3xx response, unlike a browser's opaque manual redirect response. Terminal callbacks clean up abort listeners; late callbacks do not revive completed/cancelled streams.
- On iOS, awaiting `prefetch()` now waits for completion and propagates failures, including when joining an existing prefetch. Automatic launch prefetching remains best-effort.
- `prefetchCacheTtlMs` must be finite. Zero/negative values disable reuse of completed cached responses; they do not cancel or prevent joining an in-flight prefetch. Cache age uses a monotonic clock. The existing platform-specific cache consumption policy is unchanged.

## Remaining boundaries

This is not a claim of complete browser Fetch conformance. `formData()` readers remain unsupported. Native streaming is separate from the buffered/prefetch transport; iOS pushes data without URLSession backpressure, and slow consumers can accumulate queued data. Local file operations are not made natively cancellable by the HTTP abort changes. Cloning a stream can also buffer data for its slower reader.
