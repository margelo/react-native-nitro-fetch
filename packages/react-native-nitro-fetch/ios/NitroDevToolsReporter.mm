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

// The Objective-C wrapper does not expose -isDebuggingEnabled publicly,
// but the underlying C++ NetworkReporter does. We avoid depending on the
// C++ header and instead rely on RN guarding every report call internally.
// For our own body-capture short-circuit we assume enabled when the class
// exists; the underlying calls are still no-ops when no debugger attached.

@implementation NitroDevToolsReporter

+ (BOOL)isDebuggingEnabled {
#if NITRO_HAS_NETWORK_REPORTER
  return YES;
#else
  return NO;
#endif
}

+ (void)reportRequestStartWithRequest:(NSString *)requestId
                              request:(NSURLRequest *)request {
#if NITRO_HAS_NETWORK_REPORTER
  if (request == nil) return;
  int encoded = (int)(request.HTTPBody.length);
  [RCTInspectorNetworkReporter reportRequestStart:requestId request:request encodedDataLength:encoded];
  [RCTInspectorNetworkReporter reportConnectionTiming:requestId request:request];
#endif
}

+ (void)reportRequestStart:(NSString *)requestId
                       url:(NSString *)url
                    method:(NSString *)method
                   headers:(NSDictionary<NSString *, NSString *> *)headers
                bodyString:(NSString *)bodyString {
#if NITRO_HAS_NETWORK_REPORTER
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
  [RCTInspectorNetworkReporter reportRequestStart:requestId request:req encodedDataLength:(int)encoded];
  [RCTInspectorNetworkReporter reportConnectionTiming:requestId request:req];
#endif
}

+ (void)reportResponseStart:(NSString *)requestId
                        url:(NSString *)url
                 statusCode:(NSInteger)statusCode
                    headers:(NSDictionary<NSString *, NSString *> *)headers {
#if NITRO_HAS_NETWORK_REPORTER
  NSURL *u = [NSURL URLWithString:url];
  if (u == nil) return;
  NSHTTPURLResponse *resp = [[NSHTTPURLResponse alloc] initWithURL:u
                                                         statusCode:statusCode
                                                        HTTPVersion:@"HTTP/1.1"
                                                       headerFields:headers];
  [RCTInspectorNetworkReporter reportResponseStart:requestId
                                           response:resp
                                         statusCode:(int)statusCode
                                            headers:headers];
#endif
}

+ (void)reportDataReceived:(NSString *)requestId length:(NSInteger)length {
#if NITRO_HAS_NETWORK_REPORTER
  if (length <= 0) return;
  // Only data.length is read by the underlying reporter. Avoid allocating a
  // zero-filled buffer by handing NSData a non-owned byte pointer and the
  // intended length.
  static uint8_t sentinel;
  NSData *sized = [NSData dataWithBytesNoCopy:&sentinel length:(NSUInteger)length freeWhenDone:NO];
  [RCTInspectorNetworkReporter reportDataReceived:requestId data:sized];
#endif
}

+ (void)reportResponseEnd:(NSString *)requestId encodedDataLength:(NSInteger)length {
#if NITRO_HAS_NETWORK_REPORTER
  [RCTInspectorNetworkReporter reportResponseEnd:requestId encodedDataLength:(int)length];
#endif
}

+ (void)reportRequestFailed:(NSString *)requestId cancelled:(BOOL)cancelled {
#if NITRO_HAS_NETWORK_REPORTER
  [RCTInspectorNetworkReporter reportRequestFailed:requestId cancelled:cancelled];
#endif
}

+ (void)storeResponseBody:(NSString *)requestId
                     data:(NSData *)data
            base64Encoded:(BOOL)base64Encoded {
#if NITRO_HAS_NETWORK_REPORTER
  [RCTInspectorNetworkReporter maybeStoreResponseBody:requestId data:data base64Encoded:base64Encoded];
#endif
}

+ (void)storeResponseBodyIncremental:(NSString *)requestId text:(NSString *)text {
#if NITRO_HAS_NETWORK_REPORTER
  [RCTInspectorNetworkReporter maybeStoreResponseBodyIncremental:requestId data:text];
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
