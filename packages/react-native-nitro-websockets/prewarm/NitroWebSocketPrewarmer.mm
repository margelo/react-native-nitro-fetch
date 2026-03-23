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

@implementation NitroWebSocketPrewarmer

+ (void)preWarmURL:(NSString *)url
         protocols:(NSArray<NSString *> *)protocols {
  std::string urlStr = [url UTF8String];
  std::vector<std::string> protoVec;
  protoVec.reserve([protocols count]);
  for (NSString *p in protocols) {
    protoVec.emplace_back([p UTF8String]);
  }
  margelo::nitro::nitrofetchwebsockets::WebSocketPrewarmer::instance()
    .preConnect(urlStr, protoVec, {});
}

+ (void)preWarmURL:(NSString *)url {
  [self preWarmURL:url protocols:@[]];
}

@end
