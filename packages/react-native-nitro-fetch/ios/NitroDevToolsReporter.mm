#import "NitroDevToolsReporter.h"

// RCTInspectorNetworkReporter is bundled in React-RCTNetwork. In RN < 0.76
// or when the header isn't visible (release-optimized module maps, OSS forks),
// we compile to a no-op so the module still builds.
#if __has_include(<React/RCTInspectorNetworkReporter.h>)
#import <React/RCTInspectorNetworkReporter.h>
#define NITRO_HAS_NETWORK_REPORTER 1
#else
#define NITRO_HAS_NETWORK_REPORTER 0
#endif

// During cold-start prefetch, RN's RCTInspectorNetworkReporter class may not
// be realized yet (its underlying C++ NetworkReporter singleton is brought up
// when the bridge initializes). Every entry point goes through +reporterClass,
// which uses NSClassFromString so a missing class becomes a clean no-op
// instead of crashing on a not-yet-initialized C++ singleton.

@implementation NitroDevToolsReporter

+ (Class _Nullable)reporterClass {
#if NITRO_HAS_NETWORK_REPORTER
  static Class cached = Nil;
  if (cached == Nil) {
    cached = NSClassFromString(@"RCTInspectorNetworkReporter");
  }
  return cached;
#else
  return Nil;
#endif
}

+ (BOOL)isDebuggingEnabled {
  return [self reporterClass] != Nil;
}

+ (void)reportRequestStartWithRequest:(NSString *)requestId
                              request:(NSURLRequest *)request {
#if NITRO_HAS_NETWORK_REPORTER
  if (request == nil) return;
  Class cls = [self reporterClass];
  if (cls == Nil) return;
  int encoded = (int)(request.HTTPBody.length);
  [cls reportRequestStart:requestId request:request encodedDataLength:encoded];
  [cls reportConnectionTiming:requestId request:request];
#endif
}

+ (void)reportRequestStart:(NSString *)requestId
                       url:(NSString *)url
                    method:(NSString *)method
                   headers:(NSDictionary<NSString *, NSString *> *)headers
                bodyString:(NSString *)bodyString {
#if NITRO_HAS_NETWORK_REPORTER
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
#endif
}

+ (void)reportResponseStart:(NSString *)requestId
                        url:(NSString *)url
                 statusCode:(NSInteger)statusCode
                    headers:(NSDictionary<NSString *, NSString *> *)headers {
#if NITRO_HAS_NETWORK_REPORTER
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
#endif
}

+ (void)reportDataReceived:(NSString *)requestId length:(NSInteger)length {
#if NITRO_HAS_NETWORK_REPORTER
  if (length <= 0) return;
  Class cls = [self reporterClass];
  if (cls == Nil) return;
  // Only data.length is read by the underlying reporter. Avoid allocating a
  // zero-filled buffer by handing NSData a non-owned byte pointer and the
  // intended length.
  static uint8_t sentinel;
  NSData *sized = [NSData dataWithBytesNoCopy:&sentinel length:(NSUInteger)length freeWhenDone:NO];
  [cls reportDataReceived:requestId data:sized];
#endif
}

+ (void)reportResponseEnd:(NSString *)requestId encodedDataLength:(NSInteger)length {
#if NITRO_HAS_NETWORK_REPORTER
  Class cls = [self reporterClass];
  if (cls == Nil) return;
  [cls reportResponseEnd:requestId encodedDataLength:(int)length];
#endif
}

+ (void)reportRequestFailed:(NSString *)requestId cancelled:(BOOL)cancelled {
#if NITRO_HAS_NETWORK_REPORTER
  Class cls = [self reporterClass];
  if (cls == Nil) return;
  [cls reportRequestFailed:requestId cancelled:cancelled];
#endif
}

+ (void)storeResponseBody:(NSString *)requestId
                     data:(NSData *)data
            base64Encoded:(BOOL)base64Encoded {
#if NITRO_HAS_NETWORK_REPORTER
  Class cls = [self reporterClass];
  if (cls == Nil) return;
  [cls maybeStoreResponseBody:requestId data:data base64Encoded:base64Encoded];
#endif
}

+ (void)storeResponseBodyIncremental:(NSString *)requestId text:(NSString *)text {
#if NITRO_HAS_NETWORK_REPORTER
  Class cls = [self reporterClass];
  if (cls == Nil) return;
  [cls maybeStoreResponseBodyIncremental:requestId data:text];
#endif
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
