#import "NitroDevToolsReporter.h"
#import <React/RCTVersion.h>


@interface RCTInspectorNetworkReporter : NSObject
+ (void)reportRequestStart:(NSString *)requestId
                   request:(NSURLRequest *)request
         encodedDataLength:(int)encodedDataLength;
+ (void)reportConnectionTiming:(NSString *)requestId request:(NSURLRequest *)request;
+ (void)reportResponseStart:(NSString *)requestId
                   response:(NSURLResponse *)response
                 statusCode:(int)statusCode
                    headers:(NSDictionary<NSString *, NSString *> *)headers;
+ (void)reportDataReceived:(NSString *)requestId data:(NSData *)data;
+ (void)reportResponseEnd:(NSString *)requestId encodedDataLength:(int)encodedDataLength;
+ (void)reportRequestFailed:(NSString *)requestId cancelled:(BOOL)cancelled;
+ (void)maybeStoreResponseBody:(NSString *)requestId data:(NSData *)data base64Encoded:(bool)base64Encoded;
+ (void)maybeStoreResponseBodyIncremental:(NSString *)requestId data:(NSString *)data;
@end

// During cold-start prefetch, RN's RCTInspectorNetworkReporter class may not
// be realized yet (its underlying C++ NetworkReporter singleton is brought up
// when the bridge initializes). Every entry point goes through +reporterClass,
// which uses NSClassFromString so a missing class becomes a clean no-op
// instead of crashing on a not-yet-initialized C++ singleton.

@implementation NitroDevToolsReporter

// The reporter's `requestId` API switched from NSNumber to NSString in RN 0.83. We build against
// the NSString shape, so only engage on RN >= 0.83; everything else stays a no-op.
+ (BOOL)reporterAPIAvailable {
  static BOOL available = NO;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    NSDictionary *v = RCTGetReactNativeVersion();
    NSInteger major = [v[RCTVersionMajor] integerValue];
    NSInteger minor = [v[RCTVersionMinor] integerValue];
    available = (major > 0) || (minor >= 83);
  });
  return available;
}

+ (Class _Nullable)reporterClass {
  if (![self reporterAPIAvailable]) {
    return Nil;
  }
  static Class cached = Nil;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    cached = NSClassFromString(@"RCTInspectorNetworkReporter");
  });
  return cached;
}

+ (BOOL)isDebuggingEnabled {
  return [self reporterClass] != Nil;
}

+ (void)reportRequestStartWithRequest:(NSString *)requestId
                              request:(NSURLRequest *)request {
  if (request == nil) return;
  Class cls = [self reporterClass];
  if (cls == Nil) return;
  int encoded = (int)(request.HTTPBody.length);
  [cls reportRequestStart:requestId request:request encodedDataLength:encoded];
  [cls reportConnectionTiming:requestId request:request];
}

+ (void)reportRequestStart:(NSString *)requestId
                       url:(NSString *)url
                    method:(NSString *)method
                   headers:(NSDictionary<NSString *, NSString *> *)headers
                bodyString:(NSString *)bodyString {
  Class cls = [self reporterClass];
  if (cls == Nil) return;
  NSURL *u = [NSURL URLWithString:url];
  if (u == nil) return;
  NSMutableURLRequest *req = [NSMutableURLRequest requestWithURL:u];
  req.HTTPMethod = method ?: @"GET";
  for (NSString *k in headers) {
    [req setValue:headers[k] forHTTPHeaderField:k];
  }
  if (bodyString.length > 0) {
    req.HTTPBody = [bodyString dataUsingEncoding:NSUTF8StringEncoding];
  }
  NSInteger encoded = bodyString ? (NSInteger)[bodyString lengthOfBytesUsingEncoding:NSUTF8StringEncoding] : 0;
  [cls reportRequestStart:requestId request:req encodedDataLength:(int)encoded];
  [cls reportConnectionTiming:requestId request:req];
}

+ (void)reportResponseStart:(NSString *)requestId
                        url:(NSString *)url
                 statusCode:(NSInteger)statusCode
                    headers:(NSDictionary<NSString *, NSString *> *)headers {
  Class cls = [self reporterClass];
  if (cls == Nil) return;
  NSURL *u = [NSURL URLWithString:url];
  if (u == nil) return;
  NSHTTPURLResponse *resp = [[NSHTTPURLResponse alloc] initWithURL:u
                                                         statusCode:statusCode
                                                        HTTPVersion:@"HTTP/1.1"
                                                       headerFields:headers];
  [cls reportResponseStart:requestId
                  response:resp
                statusCode:(int)statusCode
                   headers:headers];
}

+ (void)reportDataReceived:(NSString *)requestId length:(NSInteger)length {
  if (length <= 0) return;
  Class cls = [self reporterClass];
  if (cls == Nil) return;
  // Only data.length is read by the underlying reporter. Avoid allocating a
  // zero-filled buffer by handing NSData a non-owned byte pointer and the
  // intended length.
  static uint8_t sentinel;
  NSData *sized = [NSData dataWithBytesNoCopy:&sentinel length:(NSUInteger)length freeWhenDone:NO];
  [cls reportDataReceived:requestId data:sized];
}

+ (void)reportResponseEnd:(NSString *)requestId encodedDataLength:(NSInteger)length {
  Class cls = [self reporterClass];
  if (cls == Nil) return;
  [cls reportResponseEnd:requestId encodedDataLength:(int)length];
}

+ (void)reportRequestFailed:(NSString *)requestId cancelled:(BOOL)cancelled {
  Class cls = [self reporterClass];
  if (cls == Nil) return;
  [cls reportRequestFailed:requestId cancelled:cancelled];
}

+ (void)storeResponseBody:(NSString *)requestId
                     data:(NSData *)data
            base64Encoded:(BOOL)base64Encoded {
  Class cls = [self reporterClass];
  if (cls == Nil) return;
  [cls maybeStoreResponseBody:requestId data:data base64Encoded:base64Encoded];
}

+ (void)storeResponseBodyIncremental:(NSString *)requestId text:(NSString *)text {
  Class cls = [self reporterClass];
  if (cls == Nil) return;
  [cls maybeStoreResponseBodyIncremental:requestId data:text];
}

+ (BOOL)isTextualContentType:(NSString *)contentType {
  if (contentType == nil) return NO;
  NSString *ct = [contentType lowercaseString];
  if ([ct hasPrefix:@"text/"]) return YES;
  if ([ct containsString:@"application/json"]) return YES;
  if ([ct containsString:@"application/xml"]) return YES;
  if ([ct containsString:@"application/javascript"]) return YES;
  if ([ct containsString:@"+json"]) return YES;
  if ([ct containsString:@"+xml"]) return YES;
  return NO;
}

@end
