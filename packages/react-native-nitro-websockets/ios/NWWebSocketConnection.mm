//
//  NWWebSocketConnection.mm
//  Pods
//
//  Created by Ritesh Shukla on 23.03.26.
//

#import <Foundation/Foundation.h>
#include "NWWebSocketConnection.hpp"

#include <cstring>

// ── ObjC delegate bridging NSURLSession events to C++ via blocks ────────

@interface NWWSDelegate : NSObject <NSURLSessionWebSocketDelegate, NSURLSessionTaskDelegate>
@property (nonatomic, copy) void (^onOpen)(NSString* _Nullable protocol);
@property (nonatomic, copy) void (^onServerClose)(int code, NSString* _Nullable reason);
@property (nonatomic, copy) void (^onComplete)(NSError* _Nullable error);
@end

@implementation NWWSDelegate

- (void)URLSession:(NSURLSession *)session
    webSocketTask:(NSURLSessionWebSocketTask *)webSocketTask
    didOpenWithProtocol:(NSString *)protocol {
  if (self.onOpen) self.onOpen(protocol);
}

- (void)URLSession:(NSURLSession *)session
    webSocketTask:(NSURLSessionWebSocketTask *)webSocketTask
    didCloseWithCode:(NSURLSessionWebSocketCloseCode)closeCode
             reason:(NSData *)reason {
  NSString *reasonStr = nil;
  if (reason) {
    reasonStr = [[NSString alloc] initWithData:reason encoding:NSUTF8StringEncoding];
  }
  if (self.onServerClose) self.onServerClose(static_cast<int>(closeCode), reasonStr);
}

- (void)URLSession:(NSURLSession *)session
              task:(NSURLSessionTask *)task
    didCompleteWithError:(NSError *)error {
  if (self.onComplete) self.onComplete(error);
}

@end


namespace margelo::nitro::nitrofetchwebsockets {

// ── PIMPL (holds ARC-managed Foundation objects) ─────────────────────────

struct NWWebSocketConnection::Impl {
  NSURLSession* session = nil;
  NSURLSessionWebSocketTask* task = nil;
  NWWSDelegate* delegate = nil;
  // Cached once at connect() — avoids shared_from_this() + weak_ptr construction
  // on every scheduleReceive() call (every received message).
  std::weak_ptr<WebSocketConnectionBase> selfWeak;
};


// ── Construction / Destruction ───────────────────────────────────────────

NWWebSocketConnection::NWWebSocketConnection()
  : _impl(std::make_unique<Impl>()) {}

NWWebSocketConnection::~NWWebSocketConnection() {
  if (_impl) {
    if (_impl->task) {
      [_impl->task cancel];
      _impl->task = nil;
    }
    if (_impl->session) {
      [_impl->session invalidateAndCancel];
      _impl->session = nil;
    }
    _impl->delegate = nil;
  }
}


// ── connect ──────────────────────────────────────────────────────────────

void NWWebSocketConnection::connect(
    const std::string& url,
    const std::vector<std::string>& protocols,
    const std::unordered_map<std::string, std::string>& headers) {

  {
    std::lock_guard<std::mutex> lock(_strMu);
    _url = url;
    _negotiatedProtocol.clear();
  }
  _state.store(State::CONNECTING, std::memory_order_release);
  _closeFired = false;
  _openFired = false;
  _receivedCloseCode = 1005;
  _receivedCloseReason.clear();

  if (_impl->task) {
    [_impl->task cancel];
    _impl->task = nil;
  }
  if (_impl->session) {
    [_impl->session invalidateAndCancel];
    _impl->session = nil;
  }

  NSString* nsUrlStr = [NSString stringWithUTF8String:url.c_str()];
  NSURL* nsURL = [NSURL URLWithString:nsUrlStr];
  if (!nsURL) {
    fireError("Invalid WebSocket URL: " + url);
    return;
  }

  NSMutableURLRequest* request = [NSMutableURLRequest requestWithURL:nsURL];

  if (!protocols.empty()) {
    NSMutableArray<NSString*>* arr =
      [NSMutableArray arrayWithCapacity:protocols.size()];
    for (const auto& p : protocols) {
      [arr addObject:[NSString stringWithUTF8String:p.c_str()]];
    }
    [request setValue:[arr componentsJoinedByString:@", "]
        forHTTPHeaderField:@"Sec-WebSocket-Protocol"];
  }

  for (const auto& [key, value] : headers) {
    [request setValue:[NSString stringWithUTF8String:value.c_str()]
        forHTTPHeaderField:[NSString stringWithUTF8String:key.c_str()]];
  }

  _impl->delegate = [[NWWSDelegate alloc] init];

  NSURLSessionConfiguration* config =
    [NSURLSessionConfiguration defaultSessionConfiguration];
  NSOperationQueue* delegateQueue = [[NSOperationQueue alloc] init];
  delegateQueue.qualityOfService = NSQualityOfServiceUserInteractive;
  delegateQueue.maxConcurrentOperationCount = 1;
  _impl->session = [NSURLSession sessionWithConfiguration:config
                                                 delegate:_impl->delegate
                                            delegateQueue:delegateQueue];

  _impl->task = [_impl->session webSocketTaskWithRequest:request];

  auto weakSelf =
    std::weak_ptr<WebSocketConnectionBase>(shared_from_this());

  // ── didOpenWithProtocol ───────────────────────────────────────────
  _impl->delegate.onOpen = ^(NSString* protocol) {
    auto strong = weakSelf.lock();
    if (!strong) return;
    auto* conn = static_cast<NWWebSocketConnection*>(strong.get());

    conn->_state.store(State::OPEN, std::memory_order_release);

    if (protocol.length > 0) {
      std::lock_guard<std::mutex> lock(conn->_strMu);
      conn->_negotiatedProtocol = [protocol UTF8String];
    }

    OnOpen cb;
    {
      std::lock_guard<std::mutex> lock(conn->_cbMu);
      cb = conn->_onOpen;
    }
    if (cb) {
      cb();
    } else {
      conn->_openFired.store(true, std::memory_order_release);
    }

    conn->scheduleReceive();
  };

  // ── didCloseWithCode (server-initiated close frame) ───────────────
  _impl->delegate.onServerClose = ^(int code, NSString* reason) {
    auto strong = weakSelf.lock();
    if (!strong) return;
    auto* conn = static_cast<NWWebSocketConnection*>(strong.get());

    conn->_receivedCloseCode = code;
    if (reason) {
      conn->_receivedCloseReason = [reason UTF8String];
    }

    State expected = State::OPEN;
    conn->_state.compare_exchange_strong(
      expected, State::CLOSING, std::memory_order_acq_rel);
  };

  // ── didCompleteWithError (terminal event) ─────────────────────────
  _impl->delegate.onComplete = ^(NSError* error) {
    auto strong = weakSelf.lock();
    if (!strong) return;
    auto* conn = static_cast<NWWebSocketConnection*>(strong.get());

    State prev = conn->_state.load(std::memory_order_acquire);
    if (prev == State::CLOSED) return;

    bool hadCloseFrame = (conn->_receivedCloseCode != 1005);

    if (hadCloseFrame) {
      conn->fireClose(
        conn->_receivedCloseCode, conn->_receivedCloseReason, true);
    } else if (error && error.code != NSURLErrorCancelled) {
      std::string msg =
        [[error localizedDescription] UTF8String] ?: "Connection error";
      conn->fireError(msg);
      conn->fireClose(1006, "", false);
    } else {
      conn->fireClose(1000, "", true);
    }
  };

  _impl->selfWeak = shared_from_this();
  [_impl->task resume];
}


// ── close ────────────────────────────────────────────────────────────────

void NWWebSocketConnection::close(int code, const std::string& reason) {
  State expected = State::OPEN;
  if (!_state.compare_exchange_strong(expected, State::CLOSING,
        std::memory_order_acq_rel)) {
    if (expected == State::CONNECTING) {
      _state.store(State::CLOSING, std::memory_order_release);
    } else {
      return;
    }
  }

  int closeCode = (code >= 1000 && code <= 4999) ? code : 1000;
  _receivedCloseCode = closeCode;
  _receivedCloseReason = reason;

  if (!_impl->task) return;

  NSData* reasonData = nil;
  if (!reason.empty()) {
    reasonData = [NSData dataWithBytes:reason.c_str() length:reason.size()];
  }

  [_impl->task
    cancelWithCloseCode:static_cast<NSURLSessionWebSocketCloseCode>(closeCode)
                 reason:reasonData];
}


// ── send / sendBinary ────────────────────────────────────────────────────

void NWWebSocketConnection::send(const std::string& data) {
  if (_state.load(std::memory_order_acquire) != State::OPEN) return;
  if (!_impl->task) return;

  size_t len = data.size();
  _bufferedAmount.fetch_add(len, std::memory_order_relaxed);

  NSString* nsStr = [[NSString alloc] initWithBytes:data.c_str()
                                             length:len
                                           encoding:NSUTF8StringEncoding];
  NSURLSessionWebSocketMessage* msg =
    [[NSURLSessionWebSocketMessage alloc] initWithString:nsStr];

  auto weakSelf =
    std::weak_ptr<WebSocketConnectionBase>(shared_from_this());

  [_impl->task sendMessage:msg completionHandler:^(NSError* error) {
    auto strong = weakSelf.lock();
    if (!strong) return;
    auto* conn = static_cast<NWWebSocketConnection*>(strong.get());

    conn->_bufferedAmount.fetch_sub(len, std::memory_order_relaxed);
    if (error) {
      conn->fireError(
        [[error localizedDescription] UTF8String] ?: "Send failed");
    }
  }];
}

void NWWebSocketConnection::sendBinary(const uint8_t* data, size_t len) {
  if (_state.load(std::memory_order_acquire) != State::OPEN) return;
  if (!_impl->task) return;

  _bufferedAmount.fetch_add(len, std::memory_order_relaxed);

  NSData* nsData = [NSData dataWithBytes:data length:len];
  NSURLSessionWebSocketMessage* msg =
    [[NSURLSessionWebSocketMessage alloc] initWithData:nsData];

  auto weakSelf =
    std::weak_ptr<WebSocketConnectionBase>(shared_from_this());

  [_impl->task sendMessage:msg completionHandler:^(NSError* error) {
    auto strong = weakSelf.lock();
    if (!strong) return;
    auto* conn = static_cast<NWWebSocketConnection*>(strong.get());

    conn->_bufferedAmount.fetch_sub(len, std::memory_order_relaxed);
    if (error) {
      conn->fireError(
        [[error localizedDescription] UTF8String] ?: "Send binary failed");
    }
  }];
}


// ── Receive loop ─────────────────────────────────────────────────────────

void NWWebSocketConnection::scheduleReceive() {
  if (!_impl->task) return;
  State s = _state.load(std::memory_order_acquire);
  if (s == State::CLOSED || s == State::CLOSING) return;

  // Use the cached weak_ptr — avoids shared_from_this() + weak_ptr
  // construction overhead on every received message.
  auto weakSelf = _impl->selfWeak;

  [_impl->task receiveMessageWithCompletionHandler:
    ^(NSURLSessionWebSocketMessage* message, NSError* error) {
      auto strong = weakSelf.lock();
      if (!strong) return;
      auto* conn = static_cast<NWWebSocketConnection*>(strong.get());

      if (error) return;
      if (!message) {
        conn->scheduleReceive();
        return;
      }

      OnMessage onMsg;
      {
        std::lock_guard<std::mutex> lock(conn->_cbMu);
        onMsg = conn->_onMessage;
      }

      switch (message.type) {
        case NSURLSessionWebSocketMessageTypeString: {
          NSData* utf8 =
            [message.string dataUsingEncoding:NSUTF8StringEncoding];
          if (!utf8) {
            conn->scheduleReceive();
            return;
          }
          const auto* bytes = static_cast<const uint8_t*>(utf8.bytes);
          size_t len = utf8.length;

          if (onMsg) {
            onMsg(bytes, len, false);
          } else {
            std::vector<uint8_t> copy(bytes, bytes + len);
            std::lock_guard<std::mutex> lock(conn->_msgMu);
            conn->_msgBuffer.push_back({std::move(copy), false});
          }
          break;
        }

        case NSURLSessionWebSocketMessageTypeData: {
          const auto* bytes =
            static_cast<const uint8_t*>(message.data.bytes);
          size_t len = message.data.length;

          if (onMsg) {
            onMsg(bytes, len, true);
          } else {
            std::vector<uint8_t> copy(bytes, bytes + len);
            std::lock_guard<std::mutex> lock(conn->_msgMu);
            conn->_msgBuffer.push_back({std::move(copy), true});
          }
          break;
        }
      }

      conn->scheduleReceive();
    }];
}


// ── Callback setters ─────────────────────────────────────────────────────

void NWWebSocketConnection::setOnOpen(OnOpen cb) {
  OnOpen toFire;
  {
    std::lock_guard<std::mutex> lock(_cbMu);
    _onOpen = std::move(cb);
    if (_onOpen && _openFired.exchange(false, std::memory_order_acq_rel)) {
      toFire = _onOpen;
    }
  }
  if (toFire) toFire();
}

void NWWebSocketConnection::setOnMessage(OnMessage cb) {
  std::deque<BufferedMessage> replay;
  OnMessage onMsg;
  {
    std::lock_guard<std::mutex> lock(_cbMu);
    _onMessage = std::move(cb);
    onMsg = _onMessage;
  }
  if (onMsg) {
    {
      std::lock_guard<std::mutex> lock(_msgMu);
      replay = std::move(_msgBuffer);
    }
    for (auto& m : replay) {
      onMsg(m.data.data(), m.data.size(), m.isBinary);
    }
  }
}

void NWWebSocketConnection::setOnClose(OnClose cb) {
  std::lock_guard<std::mutex> lock(_cbMu);
  _onClose = std::move(cb);
}

void NWWebSocketConnection::setOnError(OnError cb) {
  std::lock_guard<std::mutex> lock(_cbMu);
  _onError = std::move(cb);
}


// ── Property getters ─────────────────────────────────────────────────────

std::string NWWebSocketConnection::url() const {
  std::lock_guard<std::mutex> lock(const_cast<std::mutex&>(_strMu));
  return _url;
}

std::string NWWebSocketConnection::protocol() const {
  std::lock_guard<std::mutex> lock(const_cast<std::mutex&>(_strMu));
  return _negotiatedProtocol;
}

std::string NWWebSocketConnection::extensions() const {
  return "";
}


// ── Internal helpers ─────────────────────────────────────────────────────

void NWWebSocketConnection::fireClose(
    int code, const std::string& reason, bool wasClean) {
  if (_closeFired.exchange(true, std::memory_order_acq_rel)) return;
  _state.store(State::CLOSED, std::memory_order_release);

  OnClose cb;
  {
    std::lock_guard<std::mutex> lock(_cbMu);
    cb = _onClose;
  }
  if (cb) cb(code, reason, wasClean);
}

void NWWebSocketConnection::fireError(const std::string& msg) {
  _state.store(State::CLOSED, std::memory_order_release);

  OnError cb;
  {
    std::lock_guard<std::mutex> lock(_cbMu);
    cb = _onError;
  }
  if (cb) cb(msg);
}


// ── Factory ──────────────────────────────────────────────────────────────

std::shared_ptr<WebSocketConnectionBase> createNWConnection() {
  return std::make_shared<NWWebSocketConnection>();
}

} // namespace margelo::nitro::nitrofetchwebsockets
