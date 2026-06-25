#import <Foundation/Foundation.h>
#import <React/RCTBridge.h>
#import <React/RCTBridgeModule.h>

// RCTBlobManager is not part of our public pod headers; forward-declare the store API.
@interface RCTBlobManager : NSObject
- (void)store:(NSData *)data withId:(NSString *)blobId;
@end

@interface NitroFetchBlobStore : NSObject <RCTBridgeModule>
@end

@implementation NitroFetchBlobStore

RCT_EXPORT_MODULE();

+ (BOOL)requiresMainQueueSetup
{
  return NO;
}

RCT_EXPORT_METHOD(storeBase64
                  : (NSString *)base64 blobId
                  : (NSString *)blobId resolve
                  : (RCTPromiseResolveBlock)resolve reject
                  : (RCTPromiseRejectBlock)reject)
{
  NSData *data = [[NSData alloc] initWithBase64EncodedString:base64
                                                     options:NSDataBase64DecodingIgnoreUnknownCharacters];
  if (data == nil) {
    reject(@"E_INVALID_BASE64", @"Failed to decode base64 blob body", nil);
    return;
  }

  RCTBridge *bridge = self.bridge;
  if (bridge == nil) {
    reject(@"E_NO_BRIDGE", @"React bridge is not available", nil);
    return;
  }

  id blobModule = [bridge moduleForName:@"BlobModule"];
  if (blobModule == nil) {
    reject(@"E_NO_BLOB_MODULE", @"BlobModule is not available", nil);
    return;
  }

  // Store synchronously so JS can immediately wrap the blob id in a Blob/File.
  [(RCTBlobManager *)blobModule store:data withId:blobId];
  resolve(@(data.length));
}

@end
