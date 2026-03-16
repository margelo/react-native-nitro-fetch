#import <Foundation/Foundation.h>
#if __has_include(<UIKit/UIKit.h>)
#import <UIKit/UIKit.h>
#endif

// No need to import the Swift header if you don’t want to.
// Just declare the C entry point:
extern "C" void NitroStartSwift(void);

@interface NitroFetchBootstrapper : NSObject @end
@implementation NitroFetchBootstrapper

+ (void)load {
#if __has_include(<UIKit/UIKit.h>)
  if (NSClassFromString(@"UIApplication")) {
    [[NSNotificationCenter defaultCenter] addObserverForName:UIApplicationDidFinishLaunchingNotification
                                                      object:nil queue:nil
                                                  usingBlock:^(__unused NSNotification *note) {
      NitroStartSwift(); // <-- call the C symbol
    }];
    dispatch_async(dispatch_get_main_queue(), ^{
      NitroStartSwift();
    });
  }
#endif
}
@end
