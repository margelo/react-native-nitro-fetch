//
//  NitroWSAutoBootstrap.mm
//
//  ObjC++ +load bootstrap that reads the prewarm queue from UserDefaults and
//  calls WebSocketPrewarmer::preConnect() before React Native starts.
//  Lives in the main NitroFetchWebsockets pod (always linked via the JS bridge)
//  so the linker never dead-strips it.
//

#import <Foundation/Foundation.h>
#import "NitroFetchWebsockets-Swift.h"
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#endif

#include "WebSocketPrewarmer.hpp"
#include <string>
#include <vector>
#include <unordered_map>

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

static NSString* NitroWSGetNestedField(NSDictionary *dict, NSString *dotPath) {
  NSArray<NSString *> *parts = [dotPath componentsSeparatedByString:@"."];
  id current = dict;
  for (NSString *part in parts) {
    if (![current isKindOfClass:[NSDictionary class]]) return nil;
    current = ((NSDictionary *)current)[part];
  }
  if (current == nil) return nil;
  if ([current isKindOfClass:[NSString class]]) return current;
  return [NSString stringWithFormat:@"%@", current];
}

/// Synchronous token refresh using NSURLSession + semaphore.
/// Must be called from a background thread (NOT the main thread).
static NSDictionary<NSString*, NSString*>* NitroWSCallTokenRefreshSync(NSDictionary *config) {
  NSString *urlStr = config[@"url"];
  if (![urlStr isKindOfClass:[NSString class]]) return nil;
  NSURL *url = [NSURL URLWithString:urlStr];
  if (!url) return nil;

  NSMutableURLRequest *request = [NSMutableURLRequest requestWithURL:url
                                                          cachePolicy:NSURLRequestUseProtocolCachePolicy
                                                      timeoutInterval:10];
  NSString *method = config[@"method"];
  request.HTTPMethod = ([method isKindOfClass:[NSString class]] ? method : @"POST");

  NSDictionary *reqHeaders = config[@"headers"];
  if ([reqHeaders isKindOfClass:[NSDictionary class]]) {
    [reqHeaders enumerateKeysAndObjectsUsingBlock:^(NSString *k, NSString *v, BOOL *stop) {
      if ([k isKindOfClass:[NSString class]] && [v isKindOfClass:[NSString class]]) {
        [request setValue:v forHTTPHeaderField:k];
      }
    }];
  }

  NSString *body = config[@"body"];
  if ([body isKindOfClass:[NSString class]]) {
    request.HTTPBody = [body dataUsingEncoding:NSUTF8StringEncoding];
  }

  __block NSData *responseData = nil;
  __block NSURLResponse *responseObj = nil;
  __block NSError *responseError = nil;

  dispatch_semaphore_t sem = dispatch_semaphore_create(0);
  [[NSURLSession.sharedSession dataTaskWithRequest:request
                                completionHandler:^(NSData *data, NSURLResponse *resp, NSError *err) {
    responseData = data;
    responseObj = resp;
    responseError = err;
    dispatch_semaphore_signal(sem);
  }] resume];
  dispatch_semaphore_wait(sem, DISPATCH_TIME_FOREVER);

  if (responseError || !responseData) return nil;
  NSHTTPURLResponse *http = (NSHTTPURLResponse *)responseObj;
  if (!http || http.statusCode < 200 || http.statusCode > 299) return nil;

  NSString *responseType = config[@"responseType"];
  BOOL isText = ([responseType isKindOfClass:[NSString class]] && [responseType isEqualToString:@"text"]);

  NSMutableDictionary<NSString*, NSString*> *result = [NSMutableDictionary new];

  if (isText) {
    NSString *text = [[NSString alloc] initWithData:responseData encoding:NSUTF8StringEncoding] ?: @"";
    NSString *textHeader = config[@"textHeader"];
    if ([textHeader isKindOfClass:[NSString class]]) {
      NSString *textTemplate = config[@"textTemplate"];
      NSString *value = ([textTemplate isKindOfClass:[NSString class]])
        ? [textTemplate stringByReplacingOccurrencesOfString:@"{{value}}" withString:text]
        : text;
      result[textHeader] = value;
    }
    return result;
  }

  // JSON
  NSDictionary *json = [NSJSONSerialization JSONObjectWithData:responseData options:0 error:nil];
  if (![json isKindOfClass:[NSDictionary class]]) return nil;

  NSArray *mappings = config[@"mappings"];
  if ([mappings isKindOfClass:[NSArray class]]) {
    for (NSDictionary *m in mappings) {
      if (![m isKindOfClass:[NSDictionary class]]) continue;
      NSString *jsonPath = m[@"jsonPath"];
      NSString *header = m[@"header"];
      if (![jsonPath isKindOfClass:[NSString class]] || ![header isKindOfClass:[NSString class]]) continue;
      NSString *val = NitroWSGetNestedField(json, jsonPath);
      if (!val) continue;
      NSString *tmpl = m[@"valueTemplate"];
      NSString *finalVal = ([tmpl isKindOfClass:[NSString class]])
        ? [tmpl stringByReplacingOccurrencesOfString:@"{{value}}" withString:val]
        : val;
      result[header] = finalVal;
    }
  }

  NSArray *compositeHeaders = config[@"compositeHeaders"];
  if ([compositeHeaders isKindOfClass:[NSArray class]]) {
    for (NSDictionary *comp in compositeHeaders) {
      if (![comp isKindOfClass:[NSDictionary class]]) continue;
      NSString *header = comp[@"header"];
      NSString *templ = comp[@"template"];
      NSDictionary *paths = comp[@"paths"];
      if (![header isKindOfClass:[NSString class]] ||
          ![templ isKindOfClass:[NSString class]] ||
          ![paths isKindOfClass:[NSDictionary class]]) continue;
      NSMutableString *built = [templ mutableCopy];
      [paths enumerateKeysAndObjectsUsingBlock:^(NSString *ph, NSString *jsonPath, BOOL *stop) {
        if (![ph isKindOfClass:[NSString class]] || ![jsonPath isKindOfClass:[NSString class]]) return;
        NSString *val = NitroWSGetNestedField(json, jsonPath) ?: @"";
        [built replaceOccurrencesOfString:[NSString stringWithFormat:@"{{%@}}", ph]
                               withString:val
                                  options:0
                                    range:NSMakeRange(0, built.length)];
      }];
      result[header] = [built copy];
    }
  }

  return result;
}

static NSDictionary<NSString*, NSString*>* NitroWSLoadCachedTokenHeaders(NSString *suiteName,
                                                                           NSString *cacheKey) {
  NSString *cacheRaw = [NitroWSSecureAtRestBridge decryptedStringForKey:cacheKey suiteName:suiteName];
  if (!cacheRaw || cacheRaw.length == 0) return @{};
  NSData *cacheData = [cacheRaw dataUsingEncoding:NSUTF8StringEncoding];
  if (!cacheData) return @{};
  NSDictionary *obj = [NSJSONSerialization JSONObjectWithData:cacheData options:0 error:nil];
  if (![obj isKindOfClass:[NSDictionary class]]) return @{};
  return (NSDictionary<NSString*, NSString*> *)obj;
}

// ---------------------------------------------------------------------------
// Core prewarm logic
// ---------------------------------------------------------------------------

static void NitroWSRunPrewarmsWithTokenHeaders(NSArray *arr,
                                               NSDictionary<NSString*, NSString*> *tokenHeaders) {
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

    // Merge: static headers first, token headers override
    __block std::unordered_map<std::string, std::string> headers;
    NSDictionary *staticHeaders = entry[@"headers"];
    if ([staticHeaders isKindOfClass:[NSDictionary class]]) {
      [staticHeaders enumerateKeysAndObjectsUsingBlock:^(id k, id v, BOOL *stop) {
        if ([k isKindOfClass:[NSString class]]) {
          headers[[k UTF8String]] = [[NSString stringWithFormat:@"%@", v] UTF8String];
        }
      }];
    }
    [tokenHeaders enumerateKeysAndObjectsUsingBlock:^(NSString *k, NSString *v, BOOL *stop) {
      headers[[k UTF8String]] = [v UTF8String];
    }];

    NSLog(@"[NitroWS] Pre-warming %@ with %zu header(s)", url, headers.size());
    for (auto &kv : headers) {
      NSLog(@"[NitroWS]   %s: %s", kv.first.c_str(), kv.second.c_str());
    }
    margelo::nitro::nitrofetchwebsockets::WebSocketPrewarmer::instance()
      .preConnect(urlStr, protocols, headers);
  }
}

static void NitroWSRunAutoPrewarm() {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    NSString *suiteName = @"nitro_fetch_storage";
    NSString *queueKey  = @"nitro_ws_prewarm_queue";
    NSString *refreshKey = @"nitro_token_refresh_websocket";
    NSString *cacheKey  = @"nitro_token_refresh_ws_cache";

    NSUserDefaults *ud = [[NSUserDefaults alloc] initWithSuiteName:suiteName];
    if (!ud) ud = [NSUserDefaults standardUserDefaults];

    NSString *raw = [ud stringForKey:queueKey];
    if (!raw || raw.length == 0) return;

    NSData *data = [raw dataUsingEncoding:NSUTF8StringEncoding];
    if (!data) return;

    NSArray *arr = [NSJSONSerialization JSONObjectWithData:data options:0 error:nil];
    if (![arr isKindOfClass:[NSArray class]]) return;

    NSLog(@"[NitroWS] Auto-prewarmer starting — %lu URL(s) in queue", (unsigned long)arr.count);

    NSString *refreshRaw = [NitroWSSecureAtRestBridge decryptedStringForKey:refreshKey suiteName:suiteName];

    if (refreshRaw && refreshRaw.length > 0) {
      // Token refresh requires a network call — dispatch to background thread
      dispatch_async(dispatch_get_global_queue(QOS_CLASS_UTILITY, 0), ^{
        NSData *refreshData = [refreshRaw dataUsingEncoding:NSUTF8StringEncoding];
        NSDictionary *refreshConfig = refreshData
          ? [NSJSONSerialization JSONObjectWithData:refreshData options:0 error:nil]
          : nil;

        NSDictionary<NSString*, NSString*> *tokenHeaders = nil;

        if ([refreshConfig isKindOfClass:[NSDictionary class]]) {
          NSString *onFailure = refreshConfig[@"onFailure"];
          if (![onFailure isKindOfClass:[NSString class]]) onFailure = @"useStoredHeaders";

          NSString *refreshURL = refreshConfig[@"url"];
          NSLog(@"[NitroWS][TokenRefresh] Calling refresh endpoint: %@", refreshURL);

          NSDictionary *refreshed = NitroWSCallTokenRefreshSync(refreshConfig);
          if (refreshed) {
            NSLog(@"[NitroWS][TokenRefresh] ✅ Success — got %lu header(s)", (unsigned long)refreshed.count);
            [refreshed enumerateKeysAndObjectsUsingBlock:^(NSString *k, NSString *v, BOOL *stop) {
              NSLog(@"[NitroWS][TokenRefresh]   %@: %@", k, v);
            }];
            // Cache fresh token headers
            NSData *cacheData = [NSJSONSerialization dataWithJSONObject:refreshed options:0 error:nil];
            if (cacheData) {
              NSString *cacheStr = [[NSString alloc] initWithData:cacheData encoding:NSUTF8StringEncoding];
              if (cacheStr) {
                [NitroWSSecureAtRestBridge setEncrypted:cacheStr forKey:cacheKey suiteName:suiteName];
              }
            }
            tokenHeaders = refreshed;
          } else {
            NSLog(@"[NitroWS][TokenRefresh] ❌ Refresh failed — onFailure: %@", onFailure);
            if ([onFailure isEqualToString:@"skip"]) {
              NSLog(@"[NitroWS][TokenRefresh] Skipping all prewarms");
              return;
            }
            tokenHeaders = NitroWSLoadCachedTokenHeaders(suiteName, cacheKey);
            NSLog(@"[NitroWS][TokenRefresh] Using cached headers (%lu header(s))", (unsigned long)tokenHeaders.count);
          }
        }

        NSLog(@"[NitroWS][TokenRefresh] Injecting token headers into %lu prewarm URL(s)", (unsigned long)arr.count);
        NitroWSRunPrewarmsWithTokenHeaders(arr, tokenHeaders ?: @{});
      });
    } else {
      // No token refresh — call preConnect directly (non-blocking C++ call)
      NSLog(@"[NitroWS] No token refresh config — prewarming without extra headers");
      NitroWSRunPrewarmsWithTokenHeaders(arr, @{});
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
