#import <Foundation/Foundation.h>
#import <React/RCTBridgeModule.h>

// Plain RN native module whose only job is to reach RN's BlobModule from a place RN
// decorates with `moduleRegistry`. Not codegen-backed: this library doesn't run RN
// codegen (no codegenConfig — it would make the app expect library-generated specs).
// Reached from JS via the New-Arch legacy interop / NativeModules. TODO: drop once
// nitrogen can expose the RN module registry to Nitro HybridObjects directly.

// Local protocol so we can call RCTBlobManager.store: without a React-RCTBlob pod dep.
@protocol NitroFetchBlobStoring <NSObject>
- (NSString *)store:(NSData *)data;
@end

@interface NitroFetchBlob : NSObject <RCTBridgeModule>
@end

@implementation NitroFetchBlob

RCT_EXPORT_MODULE(NitroFetchBlob)

// RN injects this when it creates the module — the bridgeless-safe way to reach a
// sibling RN module (RCTBlobManager) without patching react-native-nitro-modules.
@synthesize moduleRegistry = _moduleRegistry;

RCT_EXPORT_BLOCKING_SYNCHRONOUS_METHOD(createBlobId : (NSString *)base64) {
  NSData *data = [[NSData alloc] initWithBase64EncodedString:base64 options:0];
  if (data == nil) {
    return @"";
  }
  id blobModule = [self.moduleRegistry moduleForName:"BlobModule"];
  if (![blobModule respondsToSelector:@selector(store:)]) {
    return @"";
  }
  return [(id<NitroFetchBlobStoring>)blobModule store:data];
}

@end
