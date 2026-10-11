//
//  HybridWebSocket.cpp
//  Pods
//
//  Created by Ritesh Shukla on 20.03.26.
//

#include "HybridWebSocket.hpp"
#include "WebSocketPrewarmer.hpp"

#if defined(__APPLE__)
namespace margelo::nitro::nitrofetchwebsockets {
  std::shared_ptr<WebSocketConnectionBase> createNWConnection();
}
#else
#include "WebSocketConnection.hpp"
#endif

#include <NitroModules/ArrayBuffer.hpp>
#include <cstring>
#include <memory>

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

constexpr size_t kMaxDirectTextBytes = 512;

bool isWellFormedUtf8(const uint8_t* s, size_t len) {
  size_t i = 0;
  while (i < len) {
    while (i + 8 <= len) {
      uint64_t chunk;
      std::memcpy(&chunk, s + i, 8);
      if (chunk & 0x8080808080808080ULL) break;
      i += 8;
    }
    if (i >= len) break;
    const uint8_t c = s[i];
    if (c < 0x80) {
      i++;
      continue;
    }
    size_t trailing;
    uint8_t min = 0x80;
    uint8_t max = 0xBF;
    if (c >= 0xC2 && c <= 0xDF) {
      trailing = 1;
    } else if (c >= 0xE0 && c <= 0xEF) {
      trailing = 2;
      if (c == 0xE0) min = 0xA0;
      if (c == 0xED) max = 0x9F;
    } else if (c >= 0xF0 && c <= 0xF4) {
      trailing = 3;
      if (c == 0xF0) min = 0x90;
      if (c == 0xF4) max = 0x8F;
    } else {
      return false;
    }
    if (i + trailing >= len) return false;
    if (s[i + 1] < min || s[i + 1] > max) return false;
    for (size_t k = 2; k <= trailing; k++) {
      if ((s[i + k] & 0xC0) != 0x80) return false;
    }
    i += trailing + 1;
  }
  return true;
}

std::shared_ptr<ArrayBuffer> payloadToArrayBuffer(const uint8_t* data, size_t len, std::vector<uint8_t>* owned) {
  if (len == 0 || owned == nullptr) {
    return copyPayloadToArrayBuffer(data, len);
  }
  auto holder = std::make_shared<std::vector<uint8_t>>(std::move(*owned));
  return std::make_shared<NativeArrayBuffer>(holder->data(), holder->size(), [holder]() {});
}

WebSocketConnectionBase::OnMessage makeHybridMessageBridge(
    std::function<void(const HybridWebSocketMessageEvent&)> cb) {
  return [cb = std::move(cb)](const uint8_t* data, size_t len, bool isBinary, std::vector<uint8_t>* owned) {
    cb(HybridWebSocketMessageEvent{ payloadToArrayBuffer(data, len, owned), isBinary });
  };
}

WebSocketConnectionBase::OnMessage makeBatchBridge(std::function<void(WebSocketMessageQueue)> onBatch) {
  WebSocketMessageQueue queue;
  return [onBatch = std::move(onBatch), queue](const uint8_t* data, size_t len, bool isBinary, std::vector<uint8_t>* owned) {
    std::optional<WebSocketMessageQueue> batch = !isBinary && len <= kMaxDirectTextBytes && isWellFormedUtf8(data, len)
      ? queue.push(std::string(reinterpret_cast<const char*>(data), len))
      : queue.push(HybridWebSocketMessageEvent{ payloadToArrayBuffer(data, len, owned), isBinary });
    if (batch) onBatch(std::move(*batch));
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
  _conn->setOnOpen(cb ? [cb = *cb]() { cb(); } : WebSocketConnectionBase::OnOpen{});
}

std::optional<std::function<void(const HybridWebSocketMessageEvent&)>> HybridWebSocket::getOnMessage() {
  return _onMessage;
}
void HybridWebSocket::setOnMessage(
    const std::optional<std::function<void(const HybridWebSocketMessageEvent&)>>& cb) {
  _onMessage = cb;
  bindMessages();
}

std::optional<std::function<void(WebSocketMessageQueue)>> HybridWebSocket::getOnMessageBatch() {
  return _onMessageBatch;
}
void HybridWebSocket::setOnMessageBatch(const std::optional<std::function<void(WebSocketMessageQueue)>>& cb) {
  _onMessageBatch = cb;
  bindMessages();
}

void HybridWebSocket::bindMessages() {
  if (_onMessageBatch) {
    _conn->setOnMessage(makeBatchBridge(*_onMessageBatch));
  } else if (_onMessage) {
    _conn->setOnMessage(makeHybridMessageBridge(*_onMessage));
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
  if (cb) {
    _conn->setOnClose([cb = *cb](int code, const std::string& reason, bool wasClean) {
      cb(WebSocketCloseEvent{ static_cast<double>(code), reason, wasClean });
    });
  } else {
    _conn->setOnClose({});
  }
}

std::optional<std::function<void(const std::string&)>> HybridWebSocket::getOnError() {
  return _onError;
}
void HybridWebSocket::setOnError(const std::optional<std::function<void(const std::string&)>>& cb) {
  _onError = cb;
  _conn->setOnError(cb ? [cb = *cb](const std::string& msg) { cb(msg); }
                       : WebSocketConnectionBase::OnError{});
}



void HybridWebSocket::connect(
    const std::string& url,
    const std::vector<std::string>& protocols,
    const std::unordered_map<std::string, std::string>& headers) {

  auto existing = WebSocketPrewarmer::instance().tryGet(url);
  if (existing) {
    _conn->setOnOpen(nullptr);
    _conn->setOnMessage(nullptr);
    _conn->setOnClose(nullptr);
    _conn->setOnError(nullptr);

    _conn = std::move(existing);
    bindCallbacks();
    return;
  }

  _conn->connect(url, protocols, headers);
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

  auto onOpen = _onOpen;
  _conn->setOnOpen(onOpen ? [onOpen = *onOpen]() { onOpen(); }
                           : WebSocketConnectionBase::OnOpen{});

  bindMessages();

  auto onClose = _onClose;
  if (onClose) {
    _conn->setOnClose([onClose = *onClose](int code, const std::string& reason, bool wasClean) {
      onClose(WebSocketCloseEvent{ static_cast<double>(code), reason, wasClean });
    });
  } else {
    _conn->setOnClose({});
  }

  auto onError = _onError;
  _conn->setOnError(onError ? [onError = *onError](const std::string& msg) { onError(msg); }
                             : WebSocketConnectionBase::OnError{});
}

} // namespace margelo::nitro::nitrofetchwebsockets
