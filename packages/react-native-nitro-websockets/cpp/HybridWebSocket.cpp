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

namespace margelo::nitro::nitrofetchwebsockets {

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

std::optional<std::function<void(const WebSocketMessageEvent&)>> HybridWebSocket::getOnMessage() {
  return _onMessage;
}
void HybridWebSocket::setOnMessage(
    const std::optional<std::function<void(const WebSocketMessageEvent&)>>& cb) {
  _onMessage = cb;
  if (cb) {
    _conn->setOnMessage([cb = *cb](const uint8_t* data, size_t len, bool isBinary) {
      std::string text;
      std::optional<std::shared_ptr<ArrayBuffer>> binaryData;
      if (isBinary) {
        auto* raw = new uint8_t[len];
        std::memcpy(raw, data, len);
        binaryData = std::make_shared<NativeArrayBuffer>(
          raw, len, [raw]() { delete[] raw; });
      } else {
        text = std::string(reinterpret_cast<const char*>(data), len);
      }
      cb(WebSocketMessageEvent{ text, isBinary, binaryData });
    });
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

  auto onMsg = _onMessage;
  if (onMsg) {
    _conn->setOnMessage([onMsg = *onMsg](const uint8_t* data, size_t len, bool isBinary) {
      std::string text;
      std::optional<std::shared_ptr<ArrayBuffer>> binaryData;
      if (isBinary) {
        auto* raw = new uint8_t[len];
        std::memcpy(raw, data, len);
        binaryData = std::make_shared<NativeArrayBuffer>(
          raw, len, [raw]() { delete[] raw; });
      } else {
        text = std::string(reinterpret_cast<const char*>(data), len);
      }
      onMsg(WebSocketMessageEvent{ text, isBinary, binaryData });
    });
  } else {
    _conn->setOnMessage({});
  }

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
