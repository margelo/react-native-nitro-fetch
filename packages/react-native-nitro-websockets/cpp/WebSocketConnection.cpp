//
//  WebSocketConnection.cpp
//  Pods
//
//  Created by Ritesh Shukla on 20.03.26.
//

#include "WebSocketConnection.hpp"
#include "LwsContext.hpp"

#include <libwebsockets.h>
#include <cstring>
#include <stdexcept>
#include <algorithm>

namespace margelo::nitro::nitrofetchwebsockets {


struct ParsedUrl {
  std::string host;
  int port;
  std::string path;
  bool isWss;
};

static ParsedUrl parseUrl(const std::string& url) {
  ParsedUrl r;
  r.port  = 0;
  r.isWss = false;

  std::string rest;
  if (url.rfind("wss://", 0) == 0) {
    r.isWss = true;
    rest    = url.substr(6);
    r.port  = 443;
  } else if (url.rfind("ws://", 0) == 0) {
    rest   = url.substr(5);
    r.port = 80;
  } else {
    throw std::invalid_argument("Unsupported WebSocket URL scheme: " + url);
  }

  auto pathStart = rest.find('/');
  std::string hostPort = (pathStart == std::string::npos) ? rest : rest.substr(0, pathStart);
  r.path = (pathStart == std::string::npos) ? "/" : rest.substr(pathStart);

  auto colonPos = hostPort.find(':');
  if (colonPos != std::string::npos) {
    r.host = hostPort.substr(0, colonPos);
    r.port = std::stoi(hostPort.substr(colonPos + 1));
  } else {
    r.host = hostPort;
  }
  return r;
}



int nitroWsCallback(lws* wsi, enum lws_callback_reasons reason,
                    void* /*user*/, void* in, size_t len) {
  auto* conn = static_cast<WebSocketConnection*>(lws_wsi_user(wsi));

  switch (reason) {
    case LWS_CALLBACK_CLIENT_ESTABLISHED:
      if (conn) conn->handleEstablished(wsi);
      break;

    case LWS_CALLBACK_CLIENT_RECEIVE:
      if (conn) conn->handleReceive(in, len, lws_frame_is_binary(wsi) != 0);
      break;

    case LWS_CALLBACK_CLIENT_WRITEABLE:
      if (conn) conn->handleWriteable(wsi);
      break;

    case LWS_CALLBACK_CLIENT_CLOSED:
      if (conn) conn->handleClose(0, nullptr, 0);
      break;

    case LWS_CALLBACK_CLIENT_CONNECTION_ERROR: {
      if (conn) {
        const char* msg = (in && len > 0)
          ? static_cast<const char*>(in)
          : "connection error";
        conn->handleError(msg);
      }
      break;
    }

    case LWS_CALLBACK_CLIENT_APPEND_HANDSHAKE_HEADER: {
      if (conn) {
        auto** p   = static_cast<uint8_t**>(in);
        uint8_t* end = *p + len;
        conn->handleAppendHandshakeHeader(p, end, wsi);
      }
      break;
    }

    default:
      break;
  }
  return 0;
}



WebSocketConnection::WebSocketConnection() {}

WebSocketConnection::~WebSocketConnection() {
  if (_wsi != nullptr) {
    // Detach: stop the callback from accessing a destroyed object
    lws_set_wsi_user(_wsi, nullptr);
    lws_cancel_service(LwsContext::instance().ctx());
    _wsi = nullptr;
  }
}


void WebSocketConnection::connect(
    const std::string& url,
    const std::vector<std::string>& protocols,
    const std::unordered_map<std::string, std::string>& headers) {

  _url   = url;
  _state = State::CONNECTING;

  ParsedUrl parsed;
  try {
    parsed = parseUrl(url);
  } catch (const std::exception& e) {
    if (_onError) _onError(e.what());
    _state = State::CLOSED;
    return;
  }

  std::string protocolStr;
  for (size_t i = 0; i < protocols.size(); ++i) {
    if (i > 0) protocolStr += ',';
    protocolStr += protocols[i];
  }

  {
    std::lock_guard<std::mutex> lock(_pendingConnectMu);
    _pendingConnect = PendingConnect{
      parsed.host, parsed.port, parsed.path, protocolStr, parsed.isWss, headers
    };
  }

  auto self        = shared_from_this();
  auto host        = parsed.host;
  auto port        = parsed.port;
  auto path        = parsed.path;
  auto protoStr    = protocolStr;
  auto isWss       = parsed.isWss;

  LwsContext::instance().schedule([self, host, port, path, protoStr, isWss]() {
    lws_client_connect_info i = {};
    i.context      = LwsContext::instance().ctx();
    i.address      = host.c_str();
    i.port         = port;
    i.path         = path.c_str();
    i.host         = host.c_str();
    i.origin       = host.c_str();
    i.protocol     = protoStr.empty() ? "nitro-ws" : protoStr.c_str();
    i.userdata     = self.get();          // WebSocketConnection*
    i.ssl_connection = isWss ? LCCSCF_USE_SSL : 0;

    lws* wsi = lws_client_connect_via_info(&i);
    if (wsi == nullptr) {
      if (self->_onError) self->_onError("lws_client_connect_via_info returned null");
      self->_state = State::CLOSED;
    } else {
      self->_wsi = wsi;
    }
  });
}


void WebSocketConnection::close(int code, const std::string& reason) {
  if (_state == State::CLOSED || _state == State::CLOSING) return;
  _state = State::CLOSING;

  auto self = shared_from_this();
  LwsContext::instance().schedule([self, code, reason]() {
    if (!self->_wsi) return;
    int closeCode = (code >= 1000 && code <= 4999) ? code : LWS_CLOSE_STATUS_NORMAL;
    lws_close_reason(self->_wsi,
                     static_cast<lws_close_status>(closeCode),
                     reinterpret_cast<unsigned char*>(const_cast<char*>(reason.c_str())),
                     reason.size());
    lws_callback_on_writable(self->_wsi);
  });
}



void WebSocketConnection::send(const std::string& data) {
  std::vector<uint8_t> buf(LWS_PRE + data.size());
  std::memcpy(buf.data() + LWS_PRE, data.c_str(), data.size());
  {
    std::lock_guard<std::mutex> lock(_writeMu);
    _writeQueue.push_back({ std::move(buf), false });
    _bufferedAmount += data.size();
  }
  requestWrite();
}

void WebSocketConnection::sendBinary(const uint8_t* data, size_t len) {
  std::vector<uint8_t> buf(LWS_PRE + len);
  std::memcpy(buf.data() + LWS_PRE, data, len);
  {
    std::lock_guard<std::mutex> lock(_writeMu);
    _writeQueue.push_back({ std::move(buf), true });
    _bufferedAmount += len;
  }
  requestWrite();
}

void WebSocketConnection::requestWrite() {
  auto self = shared_from_this();
  LwsContext::instance().schedule([self]() {
    if (self->_wsi && self->_state == State::OPEN) {
      lws_callback_on_writable(self->_wsi);
    }
  });
}


void WebSocketConnection::setOnOpen(OnOpen cb) {
  _onOpen = std::move(cb);
  // Replay: connection already opened before this callback was registered
  if (_openFired.exchange(false) && _onOpen) {
    _onOpen();
  }
}

void WebSocketConnection::setOnMessage(OnMessage cb) {
  _onMessage = std::move(cb);
  if (_onMessage) {
    std::deque<BufferedMessage> buf;
    {
      std::lock_guard<std::mutex> lock(_msgMu);
      buf = std::move(_msgBuffer);
    }
    for (auto& m : buf) {
      _onMessage(m.data.data(), m.data.size(), m.isBinary);
    }
  }
}

void WebSocketConnection::setOnClose(OnClose cb) {
  _onClose = std::move(cb);
}

void WebSocketConnection::setOnError(OnError cb) {
  _onError = std::move(cb);
}



void WebSocketConnection::handleEstablished(lws* wsi) {
  _wsi   = wsi;
  _state = State::OPEN;

  const lws_protocols* proto = lws_get_protocol(wsi);
  if (proto && proto->name) _negotiatedProtocol = proto->name;

  if (_onOpen) {
    _onOpen();
  } else {
    // Mark so setOnOpen() fires it as soon as the callback is set
    _openFired = true;
  }
}

void WebSocketConnection::handleReceive(const void* in, size_t len, bool isBinary) {
  if (_onMessage) {
    _onMessage(static_cast<const uint8_t*>(in), len, isBinary);
  } else {
    // Buffer for replay when setOnMessage() is called
    std::vector<uint8_t> copy(static_cast<const uint8_t*>(in),
                               static_cast<const uint8_t*>(in) + len);
    std::lock_guard<std::mutex> lock(_msgMu);
    _msgBuffer.push_back({ std::move(copy), isBinary });
  }
}

void WebSocketConnection::handleWriteable(lws* wsi) {
  OutMessage msg;
  {
    std::lock_guard<std::mutex> lock(_writeMu);
    if (_writeQueue.empty()) {
      if (_state == State::CLOSING) {
        lws_close_reason(wsi, LWS_CLOSE_STATUS_NORMAL, nullptr, 0);
      }
      return;
    }
    msg = std::move(_writeQueue.front());
    _writeQueue.pop_front();
  }

  size_t payloadSize = msg.data.size() - LWS_PRE;
  _bufferedAmount -= std::min(_bufferedAmount.load(), payloadSize);

  int mode = msg.isBinary ? LWS_WRITE_BINARY : LWS_WRITE_TEXT;
  lws_write(wsi, msg.data.data() + LWS_PRE, payloadSize,
            static_cast<lws_write_protocol>(mode));

  {
    std::lock_guard<std::mutex> lock(_writeMu);
    if (!_writeQueue.empty()) lws_callback_on_writable(wsi);
  }
}

void WebSocketConnection::handleClose(int code, const char* reason, size_t len) {
  _state = State::CLOSED;
  _wsi   = nullptr;
  if (_onClose) {
    std::string r = (reason && len > 0) ? std::string(reason, len) : "";
    _onClose(code > 0 ? code : 1000, r, true);
  }
}

void WebSocketConnection::handleError(const char* msg) {
  _state = State::CLOSED;
  _wsi   = nullptr;
  if (_onError) _onError(msg ? std::string(msg) : "WebSocket error");
}

void WebSocketConnection::handleAppendHandshakeHeader(uint8_t** p, uint8_t* end, lws* wsi) {
  std::unordered_map<std::string, std::string> headers;
  {
    std::lock_guard<std::mutex> lock(_pendingConnectMu);
    if (_pendingConnect) headers = _pendingConnect->headers;
  }
  for (auto& [key, val] : headers) {
    if (lws_add_http_header_by_name(wsi,
          reinterpret_cast<const uint8_t*>(key.c_str()),
          reinterpret_cast<const uint8_t*>(val.c_str()),
          static_cast<int>(val.size()), p, end) != 0) {
      break;
    }
  }
}

} // namespace margelo::nitro::nitrofetchwebsockets
