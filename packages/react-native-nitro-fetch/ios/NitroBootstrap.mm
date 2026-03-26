#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#endif

@interface NitroAutoPrefetcher : NSObject
+ (void)prefetchOnStart;
@end

@interface NitroFetchBootstrapper : NSObject @end
@implementation NitroFetchBootstrapper

+ (void)load {
#if __has_include(<UIKit/UIKit.h>)
  if (NSClassFromString(@"UIApplication")) {
    [[NSNotificationCenter defaultCenter] addObserverForName:UIApplicationDidFinishLaunchingNotification
                                                      object:nil queue:nil
                                                  usingBlock:^(__unused NSNotification *note) {
      [NitroAutoPrefetcher prefetchOnStart];
    }];
    dispatch_async(dispatch_get_main_queue(), ^{
      [NitroAutoPrefetcher prefetchOnStart];
    });
  }
#endif
}
@end
