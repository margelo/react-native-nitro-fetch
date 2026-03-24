//
//  NitroWebSocketPrewarmer.h
//  Pods
//
//  Created by Ritesh Shukla on 23.03.26.
//

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface NitroWebSocketPrewarmer : NSObject

+ (void)preWarmURL:(NSString *)url
         protocols:(NSArray<NSString *> *)protocols
           headers:(NSDictionary<NSString *, NSString *> *)headers;

+ (void)preWarmURL:(NSString *)url
         protocols:(NSArray<NSString *> *)protocols;

+ (void)preWarmURL:(NSString *)url;

@end

NS_ASSUME_NONNULL_END
