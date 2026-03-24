//
//  NitroWSAutoBootstrap.mm
//
//  ObjC++ +load bootstrap that reads the prewarm queue from UserDefaults and
//  calls WebSocketPrewarmer::preConnect() before React Native starts.
//  Lives in the main NitroFetchWebsockets pod (always linked via the JS bridge)
//  so the linker never dead-strips it.
//

#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#endif

#include "WebSocketPrewarmer.hpp"
#include <string>
#include <vector>
#include <unordered_map>

static void NitroWSRunAutoPrewarm() {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSString *suiteName = @"nitro_fetch_storage";
    NSString *key       = @"nitro_ws_prewarm_queue";

    NSUserDefaults *ud = [[NSUserDefaults alloc] initWithSuiteName:suiteName];
    if (!ud) ud = [NSUserDefaults standardUserDefaults];

    NSString *raw = [ud stringForKey:key];
    if (!raw || raw.length == 0) return;

    NSData *data = [raw dataUsingEncoding:NSUTF8StringEncoding];
    if (!data) return;

    NSArray *arr = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (![arr isKindOfClass:[NSArray class]]) return;

    NSLog(@"[NitroWS] Auto-prewarmer starting — %lu URL(s) in queue", (unsigned long)arr.count);

    for (id item in arr) {
      if (![item isKindOfClass:[NSDictionary class]]) continue;
      NSDictionary *entry = item;

      NSString *url = entry[@"url"];
      if (![url isKindOfClass:[NSString class]] || url.length == 0) continue;

      std::string urlStr = [url UTF8String];

      std::vector<std::string> protocols;
      NSArray *protoArr = entry[@"protocols"];
      if ([protoArr isKindOfClass:[NSArray class]]) {
        for (id p in protoArr) {
          if ([p isKindOfClass:[NSString class]]) {
            protocols.emplace_back([p UTF8String]);
          }
        }
      }

      __block std::unordered_map<std::string, std::string> headers;
      NSDictionary *headersDict = entry[@"headers"];
      if ([headersDict isKindOfClass:[NSDictionary class]]) {
        [headersDict enumerateKeysAndObjectsUsingBlock:^(id k, id v, BOOL *) {
          if ([k isKindOfClass:[NSString class]]) {
            headers[[k UTF8String]] = [[NSString stringWithFormat:@"%@", v] UTF8String];
          }
        }];
      }

      NSLog(@"[NitroWS] Pre-warming %@", url);
      margelo::nitro::nitrofetchwebsockets::WebSocketPrewarmer::instance()
        .preConnect(urlStr, protocols, headers);
    }
  });
}

@interface NitroWSAutoBootstrapper : NSObject @end
@implementation NitroWSAutoBootstrapper

+ (void)load {
#if __has_include(<UIKit/UIKit.h>)
  if (NSClassFromString(@"UIApplication")) {
    [[NSNotificationCenter defaultCenter]
        addObserverForName:UIApplicationDidFinishLaunchingNotification
                    object:nil
                     queue:nil
                usingBlock:^(__unused NSNotification *note) {
      NitroWSRunAutoPrewarm();
    }];
    dispatch_async(dispatch_get_main_queue(), ^{
      NitroWSRunAutoPrewarm();
    });
  }
#endif
}

@end
