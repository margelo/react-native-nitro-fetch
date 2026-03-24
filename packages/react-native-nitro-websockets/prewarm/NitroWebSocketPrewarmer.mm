//
//  NitroWebSocketPrewarmer.mm
//  Pods
//
//  Created by Ritesh Shukla on 23.03.26.
//

#import "NitroWebSocketPrewarmer.h"
#include "WebSocketPrewarmer.hpp"

#include <string>
#include <vector>
#include <unordered_map>

@implementation NitroWebSocketPrewarmer

+ (void)preWarmURL:(NSString *)url
         protocols:(NSArray<NSString *> *)protocols
           headers:(NSDictionary<NSString *, NSString *> *)headers {
  std::string urlStr = [url UTF8String];
  std::vector<std::string> protoVec;
  protoVec.reserve([protocols count]);
  for (NSString *p in protocols) {
    protoVec.emplace_back([p UTF8String]);
  }
  __block std::unordered_map<std::string, std::string> headersMap;
  [headers enumerateKeysAndObjectsUsingBlock:^(NSString *k, NSString *v, BOOL *) {
    headersMap[[k UTF8String]] = [v UTF8String];
  }];
  margelo::nitro::nitrofetchwebsockets::WebSocketPrewarmer::instance()
    .preConnect(urlStr, protoVec, headersMap);
}

+ (void)preWarmURL:(NSString *)url
         protocols:(NSArray<NSString *> *)protocols {
  [self preWarmURL:url protocols:protocols headers:@{}];
}

+ (void)preWarmURL:(NSString *)url {
  [self preWarmURL:url protocols:@[] headers:@{}];
}

@end
