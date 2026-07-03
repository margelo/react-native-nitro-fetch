#import "NitroCdpFallbackReporter.h"
#import <React/RCTBundleURLProvider.h>
#include <atomic>

typedef NS_ENUM(NSInteger, NitroCdpSink) {
  NitroCdpSinkResolving = 0,
  NitroCdpSinkOpen = 1,
  NitroCdpSinkDead = 2,
};

static const NSUInteger kMaxPending = 256;
static const NSUInteger kMaxTrackedBodies = 128;
static const NSUInteger kMaxBodySize = 1048576;

@interface NitroCdpBodyRecord : NSObject
@property (nonatomic, strong) NSMutableString *text;
@property (nonatomic, copy, nullable) NSString *full;
@property (nonatomic) BOOL fullBase64;
@property (nonatomic) BOOL overflow;
@end

@implementation NitroCdpBodyRecord
- (instancetype)init {
  if (self = [super init]) {
    _text = [NSMutableString new];
  }
  return self;
}
@end

@interface NitroCdpFallbackReporter () <NSURLSessionWebSocketDelegate>
@end

@implementation NitroCdpFallbackReporter {
  dispatch_queue_t _queue;
  NSURLSession *_session;
  NSURLSessionWebSocketTask *_ws;
  NSMutableArray<NSString *> *_pending;
  NSMutableDictionary<NSString *, NitroCdpBodyRecord *> *_bodies;
  NitroCdpSink _sink;
  std::atomic<NSInteger> _sinkShared;
  CFAbsoluteTime _diedAt;
  NSInteger _connectAttempts;
}

+ (instancetype)shared {
  static NitroCdpFallbackReporter *instance;
  static dispatch_once_t onceToken;
  dispatch_once(&onceToken, ^{
    instance = [NitroCdpFallbackReporter new];
  });
  return instance;
}

- (instancetype)init {
  if (self = [super init]) {
    _queue = dispatch_queue_create("com.margelo.nitrofetch.devtools-cdp", DISPATCH_QUEUE_SERIAL);
    _pending = [NSMutableArray new];
    _bodies = [NSMutableDictionary new];
    NSOperationQueue *delegateQueue = [NSOperationQueue new];
    delegateQueue.underlyingQueue = _queue;
    delegateQueue.maxConcurrentOperationCount = 1;
    _session = [NSURLSession sessionWithConfiguration:[NSURLSessionConfiguration ephemeralSessionConfiguration]
                                             delegate:self
                                        delegateQueue:delegateQueue];
    [self setSink:NitroCdpSinkResolving];
    dispatch_async(_queue, ^{
      [self connectLocked];
    });
  }
  return self;
}

- (void)setSink:(NitroCdpSink)sink {
  _sink = sink;
  _sinkShared.store(sink);
}

- (BOOL)isActive {
  NitroCdpSink sink = (NitroCdpSink)_sinkShared.load();
  if (sink == NitroCdpSinkDead) {
    dispatch_async(_queue, ^{
      if (self->_sink == NitroCdpSinkDead && CFAbsoluteTimeGetCurrent() - self->_diedAt > 30) {
        [self setSink:NitroCdpSinkResolving];
        self->_connectAttempts = 0;
        [self connectLocked];
      }
    });
    return NO;
  }
  return YES;
}

- (void)connectLocked {
  NSURL *bundleURL = [[RCTBundleURLProvider sharedSettings] jsBundleURLForBundleRoot:@"index"];
  if (bundleURL == nil || bundleURL.host == nil) {
    [self dieLocked];
    return;
  }
  BOOL secure = [bundleURL.scheme isEqualToString:@"https"];
  NSString *port = bundleURL.port != nil ? [NSString stringWithFormat:@":%@", bundleURL.port] : @"";
  NSString *endpoint = [NSString stringWithFormat:@"%@://%@%@/inspector/network",
                                                  secure ? @"wss" : @"ws", bundleURL.host, port];
  NSURL *url = [NSURL URLWithString:endpoint];
  if (url == nil) {
    [self dieLocked];
    return;
  }
  _ws = [_session webSocketTaskWithURL:url];
  [_ws resume];
  [self receiveLoop:_ws];
}

- (void)receiveLoop:(NSURLSessionWebSocketTask *)task {
  __weak __typeof(self) weakSelf = self;
  [task receiveMessageWithCompletionHandler:^(NSURLSessionWebSocketMessage *message, NSError *error) {
    if (error != nil) {
      return; // URLSession:task:didCompleteWithError: handles teardown
    }
    [weakSelf receiveLoop:task];
  }];
}

- (void)URLSession:(NSURLSession *)session
     webSocketTask:(NSURLSessionWebSocketTask *)webSocketTask
didOpenWithProtocol:(NSString *)protocol {
  if (webSocketTask != _ws) {
    return;
  }
  [self setSink:NitroCdpSinkOpen];
  _connectAttempts = 0;
  for (NSString *event in _pending) {
    [self sendLocked:event];
  }
  [_pending removeAllObjects];
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
didCompleteWithError:(nullable NSError *)error {
  if (task != _ws) {
    return;
  }
  _ws = nil;
  if (_sink == NitroCdpSinkOpen) {
    // Metro restarted; try to re-attach.
    [self setSink:NitroCdpSinkResolving];
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(3 * NSEC_PER_SEC)), _queue, ^{
      [self connectLocked];
    });
  } else if (_connectAttempts < 3) {
    _connectAttempts++;
    dispatch_after(dispatch_time(DISPATCH_TIME_NOW, (int64_t)(2 * NSEC_PER_SEC)), _queue, ^{
      [self connectLocked];
    });
  } else {
    [self dieLocked];
  }
}

- (void)dieLocked {
  [self setSink:NitroCdpSinkDead];
  _diedAt = CFAbsoluteTimeGetCurrent();
  [_pending removeAllObjects];
  [_bodies removeAllObjects];
  [_ws cancel];
  _ws = nil;
}

- (void)sendLocked:(NSString *)payload {
  [_ws sendMessage:[[NSURLSessionWebSocketMessage alloc] initWithString:payload]
    completionHandler:^(NSError *error){
    }];
}

- (void)emitLocked:(NSString *)method params:(NSDictionary *)params {
  NSDictionary *event = @{@"method" : method, @"params" : params};
  NSData *data = [NSJSONSerialization dataWithJSONObject:event options:0 error:nil];
  if (data == nil) {
    return;
  }
  NSString *payload = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
  if (payload == nil) {
    return;
  }
  switch (_sink) {
    case NitroCdpSinkOpen:
      [self sendLocked:payload];
      break;
    case NitroCdpSinkResolving:
      if (_pending.count < kMaxPending) {
        [_pending addObject:payload];
      }
      break;
    case NitroCdpSinkDead:
      break;
  }
}

static double NowSec(void) {
  return [[NSDate date] timeIntervalSince1970];
}

static NSString *MimeFromHeaders(NSDictionary<NSString *, NSString *> *headers) {
  for (NSString *key in headers) {
    if ([key caseInsensitiveCompare:@"Content-Type"] == NSOrderedSame) {
      NSString *value = headers[key];
      NSRange semi = [value rangeOfString:@";"];
      NSString *mime = semi.location == NSNotFound ? value : [value substringToIndex:semi.location];
      return [mime stringByTrimmingCharactersInSet:[NSCharacterSet whitespaceCharacterSet]];
    }
  }
  return @"";
}

static NSString *ResourceType(NSString *mime) {
  if ([mime hasPrefix:@"image/"]) return @"Image";
  if ([mime hasPrefix:@"audio"] || [mime hasPrefix:@"video"]) return @"Media";
  if ([mime hasPrefix:@"font"]) return @"Font";
  return @"Fetch";
}

- (void)reportRequestStart:(NSString *)requestId
                       url:(NSString *)url
                    method:(NSString *)method
                   headers:(nullable NSDictionary<NSString *, NSString *> *)headers
                bodyString:(nullable NSString *)bodyString {
  NSDictionary *requestHeaders = headers ?: @{};
  dispatch_async(_queue, ^{
    if (self->_sink == NitroCdpSinkDead) {
      return;
    }
    double now = NowSec();
    NSMutableDictionary *request = [NSMutableDictionary dictionaryWithDictionary:@{
      @"url" : url,
      @"method" : method,
      @"headers" : requestHeaders,
    }];
    if (bodyString.length > 0 && bodyString.length <= kMaxBodySize) {
      request[@"postData"] = bodyString;
    }
    [self emitLocked:@"Network.requestWillBeSent"
              params:@{
                @"requestId" : requestId,
                @"loaderId" : @"",
                @"documentURL" : @"mobile",
                @"request" : request,
                @"timestamp" : @(now),
                @"wallTime" : @(now),
                @"initiator" : @{@"type" : @"script"},
                @"redirectHasExtraInfo" : @NO,
                @"referrerPolicy" : @"no-referrer",
                @"type" : @"Fetch",
              }];
    [self emitLocked:@"Network.requestWillBeSentExtraInfo"
              params:@{
                @"requestId" : requestId,
                @"associatedCookies" : @{},
                @"headers" : requestHeaders,
                @"connectTiming" : @{@"requestTime" : @(now)},
              }];
  });
}

- (void)reportResponseStart:(NSString *)requestId
                        url:(NSString *)url
                 statusCode:(NSInteger)statusCode
                    headers:(nullable NSDictionary<NSString *, NSString *> *)headers {
  NSDictionary *responseHeaders = headers ?: @{};
  dispatch_async(_queue, ^{
    if (self->_sink == NitroCdpSinkDead) {
      return;
    }
    NSString *mime = MimeFromHeaders(responseHeaders);
    [self emitLocked:@"Network.responseReceived"
              params:@{
                @"requestId" : requestId,
                @"loaderId" : @"",
                @"timestamp" : @(NowSec()),
                @"type" : ResourceType(mime),
                @"response" : @{
                  @"url" : url,
                  @"status" : @(statusCode),
                  @"statusText" : @"",
                  @"headers" : responseHeaders,
                  @"mimeType" : mime,
                  @"encodedDataLength" : @0,
                },
                @"hasExtraInfo" : @NO,
              }];
  });
}

- (void)reportResponseEnd:(NSString *)requestId encodedDataLength:(NSInteger)length {
  dispatch_async(_queue, ^{
    if (self->_sink == NitroCdpSinkDead) {
      return;
    }
    NitroCdpBodyRecord *record = self->_bodies[requestId];
    [self->_bodies removeObjectForKey:requestId];
    NSString *body = nil;
    BOOL base64 = NO;
    if (record != nil && !record.overflow) {
      if (record.full != nil) {
        body = record.full;
        base64 = record.fullBase64;
      } else if (record.text.length > 0) {
        body = record.text;
      }
    }
    if (body != nil) {
      [self emitLocked:@"Expo(Network.receivedResponseBody)"
                params:@{
                  @"requestId" : requestId,
                  @"body" : body,
                  @"base64Encoded" : @(base64),
                }];
    }
    [self emitLocked:@"Network.loadingFinished"
              params:@{
                @"requestId" : requestId,
                @"timestamp" : @(NowSec()),
                @"encodedDataLength" : @(length),
              }];
  });
}

- (void)reportRequestFailed:(NSString *)requestId cancelled:(BOOL)cancelled {
  dispatch_async(_queue, ^{
    if (self->_sink == NitroCdpSinkDead) {
      return;
    }
    [self->_bodies removeObjectForKey:requestId];
    [self emitLocked:@"Network.loadingFailed"
              params:@{
                @"requestId" : requestId,
                @"timestamp" : @(NowSec()),
                @"type" : @"Fetch",
                @"errorText" : cancelled ? @"net::ERR_ABORTED" : @"net::ERR_FAILED",
                @"canceled" : @(cancelled),
              }];
  });
}

- (NitroCdpBodyRecord *)recordForLocked:(NSString *)requestId {
  NitroCdpBodyRecord *record = _bodies[requestId];
  if (record == nil) {
    if (_bodies.count >= kMaxTrackedBodies) {
      NSString *evict = _bodies.allKeys.firstObject;
      if (evict != nil) {
        [_bodies removeObjectForKey:evict];
      }
    }
    record = [NitroCdpBodyRecord new];
    _bodies[requestId] = record;
  }
  return record;
}

- (void)storeResponseBody:(NSString *)requestId
                     data:(NSData *)data
            base64Encoded:(BOOL)base64Encoded {
  dispatch_async(_queue, ^{
    if (self->_sink == NitroCdpSinkDead) {
      return;
    }
    NitroCdpBodyRecord *record = [self recordForLocked:requestId];
    if (data.length > kMaxBodySize) {
      record.overflow = YES;
      return;
    }
    if (base64Encoded) {
      record.full = [data base64EncodedStringWithOptions:0];
      record.fullBase64 = YES;
    } else {
      NSString *text = [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding];
      if (text != nil) {
        record.full = text;
        record.fullBase64 = NO;
      } else {
        record.full = [data base64EncodedStringWithOptions:0];
        record.fullBase64 = YES;
      }
    }
  });
}

- (void)storeResponseBodyIncremental:(NSString *)requestId text:(NSString *)text {
  NSString *chunk = [text copy];
  dispatch_async(_queue, ^{
    if (self->_sink == NitroCdpSinkDead) {
      return;
    }
    NitroCdpBodyRecord *record = [self recordForLocked:requestId];
    if (record.overflow) {
      return;
    }
    if (record.text.length + chunk.length > kMaxBodySize) {
      record.overflow = YES;
      [record.text setString:@""];
    } else {
      [record.text appendString:chunk];
    }
  });
}

@end
