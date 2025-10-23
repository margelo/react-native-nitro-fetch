# Swift Compiler Bug Workaround for Complex Callbacks

## ✅ FIXED at Spec Level

This issue has been **fixed by restructuring the TypeScript spec** to use individual callback parameters instead of a callback struct. This causes Nitrogen to generate code that doesn't trigger the Swift compiler bug.

## The Problem (Historical)

When using Nitro Modules with complex callbacks on iOS, the Swift compiler can crash during IR generation with this error:

```
Apple Swift version 6.1.2 (swiftlang-6.1.2.1.2 clang-1700.0.13.5)
Stack dump without symbol names...
Failed frontend command
```

This occurs specifically when:

1. You store a callback struct as a property
2. The callback struct contains multiple functions
3. Those functions have parameters of complex types (`ArrayBuffer`, custom structs, etc.)

## Example That Fails

```typescript
// TypeScript/Nitro spec
export interface UrlRequestCallback {
  onRedirectReceived(info: UrlResponseInfo, newLocationUrl: string): void;
  onResponseStarted(info: UrlResponseInfo): void;
  onReadCompleted(info: UrlResponseInfo, byteBuffer: ArrayBuffer): void; // ← ArrayBuffer causes issue
  onSucceeded(info: UrlResponseInfo): void;
  onFailed(info: UrlResponseInfo | undefined, error: RequestException): void;
  onCanceled(info: UrlResponseInfo | undefined): void;
}
```

```swift
// Swift implementation - THIS CRASHES THE COMPILER:
class HybridUrlRequestBuilder: HybridUrlRequestBuilderSpec {
  private let callback: UrlRequestCallback // ❌ Compiler crash!

  init(url: String, callback: UrlRequestCallback, ...) {
    self.callback = callback
    // ...
  }
}
```

## The Solution (Implemented)

**Fix at the TypeScript spec level** so Nitrogen generates individual callbacks instead of a callback struct:

```typescript
// BEFORE (caused Swift compiler crash):
export interface UrlRequestCallback {
  onRedirectReceived(info: UrlResponseInfo, newLocationUrl: string): void;
  onResponseStarted(info: UrlResponseInfo): void;
  onReadCompleted(info: UrlResponseInfo, byteBuffer: ArrayBuffer): void;
  onSucceeded(info: UrlResponseInfo): void;
  onFailed(info: UrlResponseInfo | undefined, error: RequestException): void;
  onCanceled(info: UrlResponseInfo | undefined): void;
}

export interface NitroCronet extends HybridObject<{ android: 'kotlin'; ios: 'swift' }> {
  newUrlRequestBuilder(url: string, callback: UrlRequestCallback): UrlRequestBuilder;
}

// AFTER (works perfectly):
export type OnRedirectReceived = (info: UrlResponseInfo, newLocationUrl: string) => void;
export type OnResponseStarted = (info: UrlResponseInfo) => void;
export type OnReadCompleted = (info: UrlResponseInfo, byteBuffer: ArrayBuffer) => void;
export type OnSucceeded = (info: UrlResponseInfo) => void;
export type OnFailed = (info: UrlResponseInfo | undefined, error: RequestException) => void;
export type OnCanceled = (info: UrlResponseInfo | undefined) => void;

export interface NitroCronet extends HybridObject<{ android: 'kotlin'; ios: 'swift' }> {
  newUrlRequestBuilder(
    url: string,
    onRedirectReceived: OnRedirectReceived,
    onResponseStarted: OnResponseStarted,
    onReadCompleted: OnReadCompleted,
    onSucceeded: OnSucceeded,
    onFailed: OnFailed,
    onCanceled: OnCanceled
  ): UrlRequestBuilder;
}
```

This causes Nitrogen to generate individual function parameters instead of a callback struct, avoiding the Swift compiler bug entirely.

## Alternative: Extract Callbacks in Swift (If You Can't Change the Spec)

If you cannot change the TypeScript spec, extract and store individual callback functions in Swift:

```swift
// Swift implementation - THIS WORKS:
class HybridUrlRequestBuilder: HybridUrlRequestBuilderSpec {
  // Extract individual callbacks
  private let onRedirectReceivedCallback: (_ info: UrlResponseInfo, _ newLocationUrl: String) -> Void
  private let onResponseStartedCallback: (_ info: UrlResponseInfo) -> Void
  private let onReadCompletedCallback: (_ info: UrlResponseInfo, _ byteBuffer: ArrayBuffer) -> Void
  private let onSucceededCallback: (_ info: UrlResponseInfo) -> Void
  private let onFailedCallback: (_ info: UrlResponseInfo?, _ error: RequestException) -> Void
  private let onCanceledCallback: (_ info: UrlResponseInfo?) -> Void

  init(url: String, callback: UrlRequestCallback, ...) {
    // Extract callbacks from the struct
    self.onRedirectReceivedCallback = callback.onRedirectReceived
    self.onResponseStartedCallback = callback.onResponseStarted
    self.onReadCompletedCallback = callback.onReadCompleted
    self.onSucceededCallback = callback.onSucceeded
    self.onFailedCallback = callback.onFailed
    self.onCanceledCallback = callback.onCanceled
    // ...
  }

  func someMethod() {
    // Use individual callbacks
    onResponseStartedCallback(info)
  }
}
```

## When to Apply This Workaround

Apply this pattern when:

- ✅ Storing callbacks with `ArrayBuffer` parameters
- ✅ Storing callbacks with custom struct/interface parameters
- ✅ A callback struct has multiple functions with complex types
- ✅ You see Swift compiler crashes during build

You don't need this workaround when:

- ❌ Using simple types only (String, Int, Bool, etc.)
- ❌ Callback struct has only ONE function (even with complex types)
- ❌ Not storing the callback as a property (calling immediately is fine)
- ❌ Working on Android/Kotlin (this is Swift-specific)

## Real-World Example

See `ios/HybridUrlRequestBuilder.swift` in this project for a complete working example.

## Related Issues

- Nitro Modules Issue: https://github.com/mrousavy/nitro/issues/975
- This appears to be a Swift compiler bug in versions 6.0+
- Reproduced on Swift 6.1.2, may affect other versions

## Performance Impact

**None.** Extracting individual closures from a struct has zero performance overhead. The closures are the same whether accessed through a struct property or stored individually.

## Alternative Workarounds

If you can modify your API design:

1. **Use individual function parameters instead of a callback struct:**

```typescript
// Instead of:
createBuilder(callback: MyCallback): Builder

// Use:
createBuilder(
  onSuccess: (data: Data) => void,
  onFailure: (error: Error) => void
): Builder
```

2. **Split complex callbacks into multiple simple ones:**

```typescript
// Instead of one complex callback struct with many functions
interface ComplexCallback {
  onEvent1(data: ComplexType): void;
  onEvent2(buffer: ArrayBuffer): void;
  // ...
}

// Use multiple simple callback structs
interface Event1Callback {
  onEvent(data: ComplexType): void;
}
interface Event2Callback {
  onEvent(buffer: ArrayBuffer): void;
}
```

3. **Call callbacks immediately without storing:**

```swift
func processCallback(_ callback: MyCallback) {
  // Use callback immediately, don't store it
  callback.onEvent(data)
}
```

However, for most use cases, the extraction pattern shown above is the cleanest solution.
