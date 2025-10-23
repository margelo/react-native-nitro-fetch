# iOS/Swift Implementation Notes

## Overview

The iOS implementation mirrors the Android/Kotlin implementation structure, using URLSession instead of Cronet. The core architecture follows the same delegate/callback pattern.

## Files Implemented

### 1. `URLSessionExtensions.swift` (NEW)

Extension utilities for converting iOS types to Nitro types:

- `HTTPURLResponse.toNitro()` → `UrlResponseInfo`
- `NSError.toNitro()` → `RequestException`
- `Error.toNitro()` → `RequestException`

**Error Mapping:**

- NSURLError codes are mapped to appropriate `ErrorType` (network, security, urlsession, other)
- Includes all error details: domain, localized description, underlying errors, failing URL

### 2. `HybridUrlRequest.swift` (UPDATED)

Represents an active network request:

- Wraps `URLSessionDataTask`
- Maintains lifecycle state (`isDone`)
- Methods: `start()`, `cancel()`, `followRedirect()` (no-op), `read()` (no-op), `isDone()`

**Note:** `followRedirect()` and `read()` are no-ops on iOS because URLSession handles these automatically via delegates.

### 3. `HybridUrlRequestBuilder.swift` (COMPLETE REWRITE)

Builder pattern for configuring requests:

- Stores request configuration (URL, headers, method, body, priority)
- Supports both `setUploadBody()` (simple) and `setUploadDataProvider()` (streaming)
- Creates dedicated `URLSession` with custom delegate on `build()`

**Key Features:**

- Priority mapping: 0-4 scale → URLSessionTask priority (0.0-1.0)
- Cache control via `disableCache()`
- Upload body support for both `ArrayBuffer` and `String`
- Custom `URLSessionDelegateAdapter` for callback bridging

### 4. `URLSessionDelegateAdapter` (PRIVATE CLASS)

Bridges URLSession delegate callbacks to Nitro callbacks:

**URLSessionTaskDelegate methods:**

- `willPerformHTTPRedirection` → `callback.onRedirectReceived()`
- `didCompleteWithError` → `callback.onFailed()` or `callback.onSucceeded()`

**URLSessionDataDelegate methods:**

- `didReceive response` → `callback.onResponseStarted()`
- `didReceive data` → `callback.onReadCompleted()`

**Data Handling:**

- Converts received `Data` to `ArrayBuffer` using `ArrayBuffer.copy(data:)`
- Each chunk is delivered via `onReadCompleted()` as it arrives
- Accumulates data internally for potential future use

## Differences from Android Implementation

### 1. Threading Model

**Android:** Uses explicit `Executor` for all callbacks
**iOS:** URLSession manages threading; we dispatch to executor queue explicitly in delegates

### 2. Request Lifecycle

**Android:** Explicit `read()` calls required to pull data
**iOS:** Data arrives automatically via delegates; `read()` is a no-op

### 3. Upload Providers

**Android:** Cronet calls `read()` repeatedly on the provider
**iOS:** URLSession expects stream-based or Data-based uploads

- Current implementation: Basic support ready, full streaming TBD

### 4. Redirect Handling

**Android:** Requires explicit `followRedirect()` call
**iOS:** URLSession auto-follows; we just notify callback

## ArrayBuffer Integration

Uses Nitro's `ArrayBuffer` API:

```swift
// Copy Data to ArrayBuffer
let arrayBuffer = try ArrayBuffer.copy(data: data)

// Convert ArrayBuffer to Data
let data = arrayBuffer.toData(copyIfNeeded: true)
```

## Error Handling

All errors are converted to `RequestException` with platform-specific details:

- `platform`: Always `.iosPlatform`
- `errorType`: Mapped from NSURLError codes
- `errorDomain`: Hash of error domain
- `localizedDescription`: User-facing message
- `underlyingError`: Nested error messages
- `failingURL`: URL that caused the error

## Swift Compiler Bug Workaround

**Issue:** Swift compiler crashes (segfault in IR generation) when storing callback structs containing multiple functions with complex types like `ArrayBuffer` or custom structs.

**GitHub Issue:** https://github.com/mrousavy/nitro/issues/975

**Workaround Applied:**
Instead of storing the entire `UrlRequestCallback` struct:

```swift
// ❌ This causes Swift compiler crash:
private let callback: UrlRequestCallback
```

We extract and store individual callback functions:

```swift
// ✅ This works:
private let onRedirectReceivedCallback: (_ info: UrlResponseInfo, _ newLocationUrl: String) -> Void
private let onResponseStartedCallback: (_ info: UrlResponseInfo) -> Void
private let onReadCompletedCallback: (_ info: UrlResponseInfo, _ byteBuffer: ArrayBuffer) -> Void
// ... etc
```

This workaround is applied in both:

1. `HybridUrlRequestBuilder` - extracts callbacks from struct in `init()`
2. `URLSessionDelegateAdapter` - receives individual callbacks in `init()`

**When to Use This Pattern:**

- When storing callbacks that contain `ArrayBuffer` parameters
- When storing callbacks that contain custom struct parameters
- When a callback struct has multiple functions with complex types
- Only needed on iOS/Swift (Android/Kotlin doesn't have this issue)

## Memory Management

- Uses `weak` references for delegates to prevent retain cycles
- URLSession delegate is owned by the session
- HybridUrlRequest maintains weak reference to delegate
- Delegate maintains weak reference to HybridUrlRequest
- Individual callback closures are stored as `let` constants (strongly captured)

## Future Enhancements

### 1. Full Upload Provider Streaming

Current implementation stores upload body in memory. For true streaming:

- Implement custom `InputStream` subclass
- Bridge to `UploadDataProvider.read()` on demand
- Handle backpressure properly

### 2. Better Cache Integration

- Expose URLSession's cache metrics
- Integrate with Nitro's prefetch cache system

### 3. HTTP/3 Support

- URLSession supports HTTP/3 automatically on iOS 15+
- Could expose protocol negotiation details

### 4. Better Redirect Control

- Currently auto-follows all redirects
- Could add option to manual control via callback

## Testing Notes

The implementation follows iOS best practices and should work seamlessly with:

- HTTP/1.1, HTTP/2, HTTP/3 (iOS 15+)
- TLS 1.2, TLS 1.3
- Certificate pinning (via URLSession configuration)
- Background transfers (requires session configuration changes)

## Callback Handling

The implementation uses a workaround for a Swift compiler bug (see "Swift Compiler Bug Workaround" section above). Individual callback functions are extracted and stored separately rather than storing the entire callback struct. This pattern:

- ✅ Prevents Swift compiler crashes
- ✅ Works correctly with Nitro's reference counting
- ✅ Has no performance overhead
- ✅ Maintains the same API as Android
