#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

/**
 * Native-side prefetch registration. Call from `application:didFinishLaunchingWithOptions:`
 * to declare URLs that should be prefetched on the very first cold launch (and every
 * cold launch thereafter). Writes to the same persistent queue used by the JS
 * `prefetchOnAppStart` API; entries are deduped by `prefetchKey`.
 *
 * This header is the Obj-C facade for the Swift `NitroAutoPrefetcher` class so that
 * Swift host apps can `#import <NitroFetch/NitroAutoPrefetcher.h>` from a bridging
 * header without pulling in the pod's C++ surface.
 */
@interface NitroAutoPrefetcher : NSObject

+ (void)prefetchOnStart;

+ (void)registerPrefetchWithUrl:(NSString *)url
                    prefetchKey:(NSString *)prefetchKey
                        headers:(NSDictionary<NSString *, NSString *> *)headers;

@end

NS_ASSUME_NONNULL_END
