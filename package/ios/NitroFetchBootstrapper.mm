#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#endif

// Declare the C entry point from Swift
extern "C" void NitroStartSwift(void);

@interface NitroFetchBootstrapper : NSObject @end
@implementation NitroFetchBootstrapper

+ (void)load {
#if __has_include(<UIKit/UIKit.h>)
  if (NSClassFromString(@"UIApplication")) {
    // Listen for app launch notification
    [[NSNotificationCenter defaultCenter] addObserverForName:UIApplicationDidFinishLaunchingNotification
                                                      object:nil
                                                       queue:nil
                                                  usingBlock:^(__unused NSNotification *note) {
      NitroStartSwift();
    }];

    // Also try to call immediately in case the notification was already fired
    dispatch_async(dispatch_get_main_queue(), ^{
      NitroStartSwift();
    });
  }
#endif
}

@end
