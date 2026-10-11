//
//  HybridWebSocket.cpp
//  Pods
//
//  Created by Ritesh Shukla on 20.03.26.
//

#include "HybridWebSocket.hpp"
#include "WebSocketPrewarmer.hpp"
#include "Utf8.hpp"

#if defined(__APPLE__)
namespace margelo::nitro::nitrofetchwebsockets {
  std::shared_ptr<WebSocketConnectionBase> createNWConnection();
}
#else
#include "WebSocketConnection.hpp"
#endif

#include <NitroModules/ArrayBuffer.hpp>
#include <cstring>
#include <limits>
#include <memory>
#include <vector>

namespace margelo::nitro::nitrofetchwebsockets {

namespace {

std::shared_ptr<ArrayBuffer> sharedEmptyPayload() {
  static std::shared_ptr<ArrayBuffer> empty = [] {
    auto* raw = new uint8_t[1];
    raw[0] = 0;
    return std::make_shared<NativeArrayBuffer>(raw, 0, [raw]() { delete[] raw; });
  }();
  return empty;
}

std::shared_ptr<ArrayBuffer> copyPayloadToArrayBuffer(const uint8_t* data, size_t len) {
  if (len == 0) {
    return sharedEmptyPayload();
  }
  auto* raw = new uint8_t[len];
  std::memcpy(raw, data, len);
  return std::make_shared<NativeArrayBuffer>(raw, len, [raw]() { delete[] raw; });
}

std::shared_ptr<ArrayBuffer> payloadToArrayBuffer(const uint8_t* data, size_t len, std::vector<uint8_t>* owned) {
  if (len == 0 || owned == nullptr) {
    return copyPayloadToArrayBuffer(data, len);
  }
  auto holder = std::make_shared<std::vector<uint8_t>>(std::move(*owned));
  return std::make_shared<NativeArrayBuffer>(holder->data(), holder->size(), [holder]() {});
}

WebSocketConnectionBase::OnMessage makeHybridMessageBridge(
    WebSocketMessageQueue queue, std::function<void(const HybridWebSocketMessageEvent&)> cb) {
  return [queue, cb = std::move(cb)](const uint8_t* data, size_t len, bool isBinary, std::vector<uint8_t>* owned) {
    queue.push([cb, event = HybridWebSocketMessageEvent{ payloadToArrayBuffer(data, len, owned), isBinary }]() {
      cb(event);
    });
  };
}

constexpr size_t kMaxDirectTextBytes = 512;
#if defined(__APPLE__)
constexpr size_t kMaxDirectAsciiBytes = 16 * 1024;
#else
constexpr size_t kMaxDirectAsciiBytes = std::numeric_limits<size_t>::max();
#endif

std::vector<uint8_t> payloadToBytes(const uint8_t* data, size_t len, std::vector<uint8_t>* owned) {
  if (owned != nullptr) return std::move(*owned);
  return std::vector<uint8_t>(data, data + len);
}

WebSocketConnectionBase::OnMessage makeQueueBridge(WebSocketMessageQueue queue,
                                                   std::function<void(WebSocketMessageQueue)> onMessage) {
  auto deliver = std::make_shared<WebSocketMessageQueue::Deliver>(std::move(onMessage));
  return [queue, deliver](const uint8_t* data, size_t len, bool isBinary, std::vector<uint8_t>* owned) {
    const size_t ascii = isBinary || len > kMaxDirectAsciiBytes ? 0 : asciiPrefixLength(data, len);
    if (!isBinary && len <= kMaxDirectAsciiBytes &&
        (ascii == len || (len <= kMaxDirectTextBytes && isWellFormedUtf8(data + ascii, len - ascii)))) {
      queue.push(WebSocketMessageQueue::Text{ payloadToBytes(data, len, owned), ascii == len }, deliver);
    } else {
      queue.push(HybridWebSocketMessageEvent{ payloadToArrayBuffer(data, len, owned), isBinary }, deliver);
    }
  };
}

} // namespace

std::shared_ptr<WebSocketConnectionBase> HybridWebSocket::createConnection() {
#if defined(__APPLE__)
  return createNWConnection();
#else
  return std::make_shared<WebSocketConnection>();
#endif
}

HybridWebSocket::HybridWebSocket() : HybridObject(TAG) {
  _conn = createConnection();
  bindCallbacks();
}

HybridWebSocket::~HybridWebSocket() {
  _conn->setOnOpen(nullptr);
  _conn->setOnMessage(nullptr);
  _conn->setOnClose(nullptr);
  _conn->setOnError(nullptr);

  auto s = _conn->state();
  if (s != WebSocketConnectionBase::State::CLOSED &&
      s != WebSocketConnectionBase::State::CLOSING) {
    _conn->close(1001, "");
  }
}

WebSocketReadyState HybridWebSocket::getReadyState() {
  return static_cast<WebSocketReadyState>(_conn->state());
}

std::string HybridWebSocket::getUrl() {
  return _conn->url();
}

double HybridWebSocket::getBufferedAmount() {
  return static_cast<double>(_conn->bufferedAmount());
}

std::string HybridWebSocket::getProtocol() {
  return _conn->protocol();
}

std::string HybridWebSocket::getExtensions() {
  return _conn->extensions();
}

std::optional<std::function<void()>> HybridWebSocket::getOnOpen() {
  return _onOpen;
}
void HybridWebSocket::setOnOpen(const std::optional<std::function<void()>>& cb) {
  _onOpen = cb;
  bindOpen();
}

void HybridWebSocket::bindOpen() {
  if (!_onOpen) {
    _conn->setOnOpen({});
    return;
  }
  _conn->setOnOpen([events = _events, cb = *_onOpen]() { events.push([cb]() { cb(); }); });
}

std::optional<std::function<void(const HybridWebSocketMessageEvent&)>> HybridWebSocket::getOnMessage() {
  return _onMessage;
}
void HybridWebSocket::setOnMessage(
    const std::optional<std::function<void(const HybridWebSocketMessageEvent&)>>& cb) {
  _onMessage = cb;
  bindMessages();
}

std::optional<std::function<void(WebSocketMessageQueue)>> HybridWebSocket::getOnQueuedMessage() {
  return _onQueuedMessage;
}
void HybridWebSocket::setOnQueuedMessage(const std::optional<std::function<void(WebSocketMessageQueue)>>& cb) {
  _onQueuedMessage = cb;
  bindMessages();
}

void HybridWebSocket::bindMessages() {
  if (_onQueuedMessage) {
    _conn->setOnMessage(makeQueueBridge(_events, *_onQueuedMessage));
  } else if (_onMessage) {
    _conn->setOnMessage(makeHybridMessageBridge(_events, *_onMessage));
  } else {
    _conn->setOnMessage({});
  }
}

std::optional<std::function<void(const WebSocketCloseEvent&)>> HybridWebSocket::getOnClose() {
  return _onClose;
}
void HybridWebSocket::setOnClose(
    const std::optional<std::function<void(const WebSocketCloseEvent&)>>& cb) {
  _onClose = cb;
  bindClose();
}

void HybridWebSocket::bindClose() {
  if (!_onClose) {
    _conn->setOnClose({});
    return;
  }
  _conn->setOnClose([events = _events, cb = *_onClose](int code, const std::string& reason, bool wasClean) {
    events.push([cb, event = WebSocketCloseEvent{ static_cast<double>(code), reason, wasClean }]() { cb(event); });
  });
}

std::optional<std::function<void(const std::string&)>> HybridWebSocket::getOnError() {
  return _onError;
}
void HybridWebSocket::setOnError(const std::optional<std::function<void(const std::string&)>>& cb) {
  _onError = cb;
  bindError();
}

void HybridWebSocket::bindError() {
  if (!_onError) {
    _conn->setOnError({});
    return;
  }
  _conn->setOnError([events = _events, cb = *_onError](const std::string& msg) {
    events.push([cb, msg]() { cb(msg); });
  });
}



void HybridWebSocket::connect(
    const std::string& url,
    const std::vector<std::string>& protocols,
    const std::unordered_map<std::string, std::string>& headers) {

  auto existing = WebSocketPrewarmer::instance().tryGet(url);
  const bool adopted = existing != nullptr;
  if (adopted || _connected) {
    _conn->setOnOpen(nullptr);
    _conn->setOnMessage(nullptr);
    _conn->setOnClose(nullptr);
    _conn->setOnError(nullptr);
    if (_connected) _conn->close(1001, "");

    _conn = adopted ? std::move(existing) : createConnection();
    bindCallbacks();
  }
  _connected = true;
  if (!adopted) _conn->connect(url, protocols, headers);
}

void HybridWebSocket::close(double code, const std::string& reason) {
  _conn->close(static_cast<int>(code), reason);
}

void HybridWebSocket::send(const std::string& data) {
  _conn->send(data);
}

void HybridWebSocket::sendBinary(const std::shared_ptr<ArrayBuffer>& data) {
  _conn->sendBinary(data->data(), data->size());
}


void HybridWebSocket::bindCallbacks() {
  bindOpen();
  bindMessages();
  bindError();
  bindClose();
}

} // namespace margelo::nitro::nitrofetchwebsockets
