#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/// RN < 0.83 fallback: streams Expo-shaped CDP events to the Expo CLI's /inspector/network websocket; no-ops where the endpoint doesn't exist.
@interface NitroCdpFallbackReporter : NSObject

+ (instancetype)shared;

- (BOOL)isActive;

- (void)reportRequestStart:(NSString *)requestId
                       url:(NSString *)url
                    method:(NSString *)method
                   headers:(nullable NSDictionary<NSString *, NSString *> *)headers
                bodyString:(nullable NSString *)bodyString;

- (void)reportResponseStart:(NSString *)requestId
                        url:(NSString *)url
                 statusCode:(NSInteger)statusCode
                    headers:(nullable NSDictionary<NSString *, NSString *> *)headers;

- (void)reportResponseEnd:(NSString *)requestId encodedDataLength:(NSInteger)length;

- (void)reportRequestFailed:(NSString *)requestId cancelled:(BOOL)cancelled;

- (void)storeResponseBody:(NSString *)requestId
                     data:(NSData *)data
            base64Encoded:(BOOL)base64Encoded;

- (void)storeResponseBodyIncremental:(NSString *)requestId text:(NSString *)text;

@end

NS_ASSUME_NONNULL_END
