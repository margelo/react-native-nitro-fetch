#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// Swift-friendly facade over RCTInspectorNetworkReporter.
/// All methods are no-ops when the modern CDP debugger is not attached
/// (checked via -isDebuggingEnabled). Safe to call in release builds.
@interface NitroDevToolsReporter : NSObject

+ (BOOL)isDebuggingEnabled;

+ (void)reportRequestStartWithRequest:(NSString *)requestId
                              request:(NSURLRequest *)request;

+ (void)reportRequestStart:(NSString *)requestId
                       url:(NSString *)url
                    method:(NSString *)method
                   headers:(NSDictionary<NSString *, NSString *> *)headers
                bodyString:(nullable NSString *)bodyString;

+ (void)reportResponseStart:(NSString *)requestId
                        url:(NSString *)url
                 statusCode:(NSInteger)statusCode
                    headers:(NSDictionary<NSString *, NSString *> *)headers;

+ (void)reportDataReceived:(NSString *)requestId length:(NSInteger)length;

+ (void)reportResponseEnd:(NSString *)requestId encodedDataLength:(NSInteger)length;

+ (void)reportRequestFailed:(NSString *)requestId cancelled:(BOOL)cancelled;

+ (void)storeResponseBody:(NSString *)requestId
                     data:(NSData *)data
            base64Encoded:(BOOL)base64Encoded;

+ (void)storeResponseBodyIncremental:(NSString *)requestId text:(NSString *)text;

+ (BOOL)isTextualContentType:(nullable NSString *)contentType;

@end

NS_ASSUME_NONNULL_END
