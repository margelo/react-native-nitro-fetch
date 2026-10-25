//
//  WebSocketConnection.cpp
//  Pods
//
//  Created by Ritesh Shukla on 20.03.26.
//

#include "WebSocketConnection.hpp"
#include "LwsContext.hpp"

#include <libwebsockets.h>
#include <mbedtls/x509_crt.h>
#include <cctype>
#include <cstring>
#include <stdexcept>
#include <algorithm>

#if defined(NITRO_WS_TRACING)
#include <android/trace.h>
#endif

// LwsPeerChain.c: the certificate chain the server sent, leaf first.
extern "C" const mbedtls_x509_crt* nitro_ws_peer_chain(struct lws* wsi);

namespace margelo::nitro::nitrofetchwebsockets {


struct ParsedUrl {
  std::string host;
  int port;
  std::string path;
  bool isWss;
  std::string hostHeader;
};

static std::string percentEncodeTarget(const std::string& target) {
  static const char kHex[] = "0123456789ABCDEF";
  std::string out;
  out.reserve(target.size());
  bool inQuery = false;
  for (unsigned char c : target) {
    if (c == '?' && !inQuery) {
      inQuery = true;
      out += '?';
      continue;
    }
    const bool encode = c <= 0x20 || c >= 0x7F || c == '"' || c == '<' || c == '>' ||
                        (inQuery ? c == '\'' : (c == '`' || c == '{' || c == '}'));
    if (encode) {
      out += '%';
      out += kHex[c >> 4];
      out += kHex[c & 0xF];
    } else {
      out += static_cast<char>(c);
    }
  }
  return out;
}

static ParsedUrl parseUrl(const std::string& url) {
  ParsedUrl r;
  const size_t schemeEnd = url.find("://");
  std::string scheme = schemeEnd == std::string::npos ? std::string() : url.substr(0, schemeEnd);
  std::transform(scheme.begin(), scheme.end(), scheme.begin(),
                 [](unsigned char c) { return static_cast<char>(std::tolower(c)); });
  if (scheme == "wss" || scheme == "https") {
    r.isWss = true;
    r.port  = 443;
  } else if (scheme == "ws" || scheme == "http") {
    r.isWss = false;
    r.port  = 80;
  } else {
    throw std::invalid_argument("Unsupported WebSocket URL scheme: " + url);
  }
  const int defaultPort = r.port;

  const size_t authorityStart = schemeEnd + 3;
  const size_t authorityEnd = url.find_first_of("/?#", authorityStart);
  std::string authority = url.substr(authorityStart, authorityEnd == std::string::npos
    ? std::string::npos : authorityEnd - authorityStart);
  const size_t at = authority.rfind('@');
  if (at != std::string::npos) authority = authority.substr(at + 1);

  if (!authority.empty() && authority[0] == '[') {
    throw std::invalid_argument("IPv6 addresses are not supported: " + url);
  }
  const size_t colon = authority.rfind(':');
  r.host = authority.substr(0, colon);
  const std::string port = colon == std::string::npos ? std::string() : authority.substr(colon + 1);
  if (r.host.empty() || r.host.find(':') != std::string::npos) {
    throw std::invalid_argument("Invalid WebSocket URL: " + url);
  }
  if (!port.empty()) {
    if (port.find_first_not_of("0123456789") != std::string::npos) {
      throw std::invalid_argument("Invalid WebSocket URL: " + url);
    }
    int value = 0;
    for (char c : port) {
      value = value * 10 + (c - '0');
      if (value > 65535) throw std::invalid_argument("Invalid WebSocket URL: " + url);
    }
    if (value == 0) throw std::invalid_argument("Invalid WebSocket URL: " + url);
    r.port = value;
  }

  std::string target = authorityEnd == std::string::npos ? std::string() : url.substr(authorityEnd);
  const size_t fragment = target.find('#');
  if (fragment != std::string::npos) target.resize(fragment);
  r.path = percentEncodeTarget(target);
  if (r.path.empty() || r.path[0] != '/') r.path = "/" + r.path;

  r.hostHeader = r.host;
  if (r.port != defaultPort) r.hostHeader += ":" + std::to_string(r.port);
  return r;
}



static bool hasScheme(const std::string& ref) {
  const size_t colon = ref.find(':');
  if (colon == 0 || colon == std::string::npos || colon > ref.find_first_of("/?#")) return false;
  if (!std::isalpha(static_cast<unsigned char>(ref[0]))) return false;
  for (size_t i = 1; i < colon; ++i) {
    const unsigned char c = static_cast<unsigned char>(ref[i]);
    if (!std::isalnum(c) && c != '+' && c != '-' && c != '.') return false;
  }
  return true;
}

static std::string resolveLocation(const std::string& base, const std::string& ref) {
  if (hasScheme(ref)) return ref;
  const size_t schemeEnd = base.find("://");
  if (schemeEnd == std::string::npos) return ref;
  if (ref.rfind("//", 0) == 0) return base.substr(0, schemeEnd + 1) + ref;
  const size_t authorityEnd = base.find_first_of("/?#", schemeEnd + 3);
  const std::string origin = base.substr(0, authorityEnd);
  if (!ref.empty() && ref[0] == '/') return origin + ref;
  std::string path = authorityEnd == std::string::npos
    ? "/"
    : base.substr(authorityEnd, base.find_first_of("?#", authorityEnd) - authorityEnd);
  if (path.empty() || path[0] != '/') path = "/" + path;
  if (ref.empty() || ref[0] == '#') return origin + path;
  if (ref[0] == '?') return origin + path + ref;
  return origin + path.substr(0, path.rfind('/') + 1) + ref;
}

static bool equalsIgnoreCase(const std::string& a, const std::string& b) {
  return a.size() == b.size() &&
         std::equal(a.begin(), a.end(), b.begin(), [](unsigned char x, unsigned char y) {
           return std::tolower(x) == std::tolower(y);
         });
}

static bool isSameOrigin(const std::string& a, const std::string& b) {
  try {
    const ParsedUrl from = parseUrl(a);
    const ParsedUrl to = parseUrl(b);
    return from.isWss == to.isWss && from.port == to.port && equalsIgnoreCase(from.host, to.host);
  } catch (const std::exception&) {
    return false;
  }
}

int nitroWsCallback(lws* wsi, enum lws_callback_reasons reason,
                    void* /*user*/, void* in, size_t len) {
  auto* conn = static_cast<WebSocketConnection*>(lws_wsi_user(wsi));

  switch (reason) {
    case LWS_CALLBACK_CLIENT_FILTER_PRE_ESTABLISH:
      if (conn) conn->handleFilterPreEstablish(wsi);
      break;

    case LWS_CALLBACK_CLIENT_ESTABLISHED:
      if (conn) conn->handleEstablished(wsi);
      break;

    case LWS_CALLBACK_CLIENT_RECEIVE:
      if (conn) conn->handleReceiveFragment(wsi, in, len);
      break;

    case LWS_CALLBACK_CLIENT_WRITEABLE:
      if (conn) return conn->handleWriteable(wsi);
      return 0;

    case LWS_CALLBACK_WS_PEER_INITIATED_CLOSE:
      if (conn) conn->handlePeerClose(in, len);
      break;

    case LWS_CALLBACK_CLIENT_CLOSED: {
      if (!conn) break;
      auto keepAlive = conn->takeSelfRef();
      conn->handleClose();
      break;
    }

    case LWS_CALLBACK_CLIENT_CONNECTION_ERROR: {
      if (!conn) break;
      // A redirect replaces the wsi, so the self-reference must survive it.
      if (conn->consumeRedirectFlag()) break;
      auto keepAlive = conn->takeSelfRef();
      const char* msg = (in && len > 0)
        ? static_cast<const char*>(in)
        : "connection error";
      conn->handleError(msg);
      break;
    }

    case LWS_CALLBACK_CLIENT_HTTP_REDIRECT: {
      if (conn && in) {
        std::string location(static_cast<const char*>(in));
        conn->handleRedirect(location);
      }
      return -1;
    }

    case LWS_CALLBACK_CLIENT_APPEND_HANDSHAKE_HEADER: {
      if (conn) {
        auto** p   = static_cast<uint8_t**>(in);
        uint8_t* end = *p + len;
        if (!conn->handleAppendHandshakeHeader(p, end, wsi)) {
          lws_set_wsi_user(wsi, nullptr);
          auto keepAlive = conn->takeSelfRef();
          conn->handleError(nullptr);
          return -1;
        }
      }
      break;
    }

    default:
      break;
  }
  return 0;
}



WebSocketConnection::WebSocketConnection() {}


void WebSocketConnection::connect(
    const std::string& url,
    const std::vector<std::string>& protocols,
    const std::unordered_map<std::string, std::string>& headers) {
  _state = State::CONNECTING;
  startConnect(url, protocols, headers);
}

void WebSocketConnection::startConnect(
    const std::string& url,
    const std::vector<std::string>& protocols,
    const std::unordered_map<std::string, std::string>& headers) {

  _url = url;
  _negotiatedProtocol.clear();

#if defined(NITRO_WS_TRACING)
  ATrace_beginSection(("NitroWS connect " + url).c_str());
#endif

  ParsedUrl parsed;
  try {
    parsed = parseUrl(url);
  } catch (const std::exception& e) {
    std::string what = e.what();
    _state = State::CLOSED;
    auto self = std::static_pointer_cast<WebSocketConnection>(shared_from_this());
    LwsContext::instance().schedule([self, what]() {
      self->fireError(what);
      self->fireClose(1006, "", false);
    });
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
      parsed.host, parsed.port, parsed.path, protocolStr, protocols, parsed.isWss, headers
    };
  }

  auto self        = std::static_pointer_cast<WebSocketConnection>(shared_from_this());
  auto host        = parsed.host;
  auto port        = parsed.port;
  auto path        = parsed.path;
  auto protoStr    = protocolStr;
  auto isWss       = parsed.isWss;
  auto hostHeader  = parsed.hostHeader;

  LwsContext::instance().schedule([self, host, port, path, protoStr, isWss, hostHeader]() {
    self->_selfRef = self;
    if (self->_state.load() != State::CONNECTING) {
      self->_selfRef.reset();
      self->fireError("closed before established");
      self->fireClose(1006, "", false);
      return;
    }

    lws_client_connect_info i = {};
    i.context      = LwsContext::instance().ctx();
    i.address      = host.c_str();
    i.port         = port;
    i.path         = path.c_str();
    i.host         = hostHeader.c_str();
    i.protocol     = protoStr.empty() ? nullptr : protoStr.c_str();
    i.local_protocol_name = "nitro-ws";
    i.userdata     = self.get();
    i.ssl_connection = isWss ? LCCSCF_USE_SSL : 0;

    lws* wsi = lws_client_connect_via_info(&i);
    if (wsi == nullptr) {
      self->_selfRef.reset();
      self->fireError("lws_client_connect_via_info returned null");
      self->fireClose(1006, "", false);
    } else {
      self->_wsi = wsi;
    }
  });
#if defined(NITRO_WS_TRACING)
  ATrace_endSection();
#endif
}


void WebSocketConnection::close(int code, const std::string& reason) {
  State prev = _state.load();
  do {
    if (prev == State::CLOSING || prev == State::CLOSED) return;
  } while (!_state.compare_exchange_weak(prev, State::CLOSING));

  int closeCode = (code >= 1000 && code <= 4999) ? code : LWS_CLOSE_STATUS_NORMAL;

  auto self = std::static_pointer_cast<WebSocketConnection>(shared_from_this());
  LwsContext::instance().schedule([self, prev, closeCode, reason]() {
    self->_localCloseCode   = closeCode;
    self->_localCloseReason = reason;
    if (!self->_wsi) return;
    if (prev == State::CONNECTING) {
      // Mid-handshake the wsi still has an HTTP role; lws_close_reason() would assert.
      lws_set_timeout(self->_wsi, PENDING_TIMEOUT_USER_OK, LWS_TO_KILL_ASYNC);
      return;
    }
    lws_close_reason(self->_wsi,
                     static_cast<lws_close_status>(closeCode),
                     reinterpret_cast<unsigned char*>(const_cast<char*>(reason.c_str())),
                     reason.size());
    lws_set_timeout(self->_wsi, PENDING_TIMEOUT_CLOSE_SEND, 5);
    lws_callback_on_writable(self->_wsi);
  });
}



void WebSocketConnection::send(const std::string& data) {
#if defined(NITRO_WS_TRACING)
  ATrace_beginSection("NitroWS send text");
#endif
  std::vector<uint8_t> buf(LWS_PRE + data.size());
  std::memcpy(buf.data() + LWS_PRE, data.c_str(), data.size());
  {
    std::lock_guard<std::mutex> lock(_writeMu);
    _writeQueue.push_back({ std::move(buf), false });
    _bufferedAmount += data.size();
  }
  requestWrite();
#if defined(NITRO_WS_TRACING)
  ATrace_endSection();
#endif
}

void WebSocketConnection::sendBinary(const uint8_t* data, size_t len) {
#if defined(NITRO_WS_TRACING)
  ATrace_beginSection("NitroWS send binary");
#endif
  std::vector<uint8_t> buf(LWS_PRE + len);
  std::memcpy(buf.data() + LWS_PRE, data, len);
  {
    std::lock_guard<std::mutex> lock(_writeMu);
    _writeQueue.push_back({ std::move(buf), true });
    _bufferedAmount += len;
  }
  requestWrite();
#if defined(NITRO_WS_TRACING)
  ATrace_endSection();
#endif
}

void WebSocketConnection::requestWrite() {
  auto self = std::static_pointer_cast<WebSocketConnection>(shared_from_this());
  LwsContext::instance().schedule([self]() {
    if (self->_wsi && self->_state == State::OPEN) {
      lws_callback_on_writable(self->_wsi);
    }
  });
}


// The lws service thread invokes these, so it also owns them: assigning from
// the JS thread would free a std::function mid-call.
void WebSocketConnection::setOnOpen(OnOpen cb) {
  auto self = std::static_pointer_cast<WebSocketConnection>(shared_from_this());
  LwsContext::instance().schedule([self, cb = std::move(cb)]() mutable {
    self->_onOpen = std::move(cb);
    if (self->_onOpen && self->_openFired.exchange(false)) {
      self->_onOpen();
    }
  });
}

void WebSocketConnection::setOnMessage(OnMessage cb) {
  auto self = std::static_pointer_cast<WebSocketConnection>(shared_from_this());
  LwsContext::instance().schedule([self, cb = std::move(cb)]() mutable {
    self->_onMessage = std::move(cb);
    if (!self->_onMessage) return;

    std::deque<BufferedMessage> buf;
    {
      std::lock_guard<std::mutex> lock(self->_msgMu);
      buf = std::move(self->_msgBuffer);
    }
    for (auto& m : buf) {
      self->_onMessage(m.data.data(), m.data.size(), m.isBinary, &m.data);
    }
  });
}

void WebSocketConnection::setOnClose(OnClose cb) {
  auto self = std::static_pointer_cast<WebSocketConnection>(shared_from_this());
  LwsContext::instance().schedule([self, cb = std::move(cb)]() mutable {
    self->_onClose = std::move(cb);
    if (self->_onClose && self->_closePending) {
      PendingClose pending = std::move(*self->_closePending);
      self->_closePending.reset();
      self->_onClose(pending.code, pending.reason, pending.wasClean);
    }
  });
}

void WebSocketConnection::setOnError(OnError cb) {
  auto self = std::static_pointer_cast<WebSocketConnection>(shared_from_this());
  LwsContext::instance().schedule([self, cb = std::move(cb)]() mutable {
    self->_onError = std::move(cb);
    if (self->_onError && self->_errorPending) {
      std::string pending = std::move(*self->_errorPending);
      self->_errorPending.reset();
      self->_onError(pending);
    }
  });
}



// Server-selected subprotocol must be read here: lws detaches the header
// table before LWS_CALLBACK_CLIENT_ESTABLISHED fires.
void WebSocketConnection::handleFilterPreEstablish(lws* wsi) {
  char buf[256];
  int n = lws_hdr_copy(wsi, buf, sizeof(buf), WSI_TOKEN_PROTOCOL);
  if (n > 0) _negotiatedProtocol.assign(buf, static_cast<size_t>(n));
}

void WebSocketConnection::handleEstablished(lws* wsi) {
#if defined(NITRO_WS_TRACING)
  ATrace_beginSection("NitroWS established");
#endif
  _wsi = wsi;
  _redirectCount = 0;

  State expected = State::CONNECTING;
  if (_state.compare_exchange_strong(expected, State::OPEN)) {
    if (_onOpen) {
      _onOpen();
    } else {
      _openFired = true;
    }
  }
#if defined(NITRO_WS_TRACING)
  ATrace_endSection();
#endif
}

void WebSocketConnection::handleReceive(const void* in, size_t len, bool isBinary, std::vector<uint8_t>* owned) {
  if (_onMessage) {
    _onMessage(static_cast<const uint8_t*>(in), len, isBinary, owned);
  } else {
    std::vector<uint8_t> copy = owned != nullptr
      ? std::move(*owned)
      : std::vector<uint8_t>(static_cast<const uint8_t*>(in), static_cast<const uint8_t*>(in) + len);
    std::lock_guard<std::mutex> lock(_msgMu);
    _msgBuffer.push_back({ std::move(copy), isBinary });
  }
}

void WebSocketConnection::handleReceiveFragment(lws* wsi, const void* in, size_t len) {
#if defined(NITRO_WS_TRACING)
  ATrace_beginSection("NitroWS receive");
#endif
  bool isBinary = lws_frame_is_binary(wsi) != 0;
  bool isFirst  = lws_is_first_fragment(wsi) != 0;
  bool isFinal  = lws_is_final_fragment(wsi) != 0;

  // Fast path: single-frame message (most common case)
  if (isFirst && isFinal) {
    handleReceive(in, len, isBinary, nullptr);
#if defined(NITRO_WS_TRACING)
    ATrace_endSection();
#endif
    return;
  }

  // Multi-frame: accumulate fragments
  if (isFirst) {
    _rxBuf.clear();
    _rxBinary = isBinary;
    _rxDiscard = false;
    _rxBuf.reserve(std::min(len + lws_remaining_packet_payload(wsi), kMaxMessageSize));
  }

  if (_rxDiscard) return;

  // Max message size guard — close with 1009 (Message Too Big)
  if (_rxBuf.size() + len > kMaxMessageSize) {
    _rxBuf.clear();
    _rxBuf.shrink_to_fit();
    _rxDiscard = true;
    close(1009, "message too large");
    return;
  }

  const uint8_t* data = static_cast<const uint8_t*>(in);
  _rxBuf.insert(_rxBuf.end(), data, data + len);

  if (isFinal) {
    handleReceive(_rxBuf.data(), _rxBuf.size(), _rxBinary, &_rxBuf);
    _rxBuf.clear();
    _rxBuf.shrink_to_fit();
  }
#if defined(NITRO_WS_TRACING)
  ATrace_endSection();
#endif
}

int WebSocketConnection::handleWriteable(lws* wsi) {
  OutMessage msg;
  {
    std::lock_guard<std::mutex> lock(_writeMu);
    if (_writeQueue.empty()) {
      if (_state != State::CLOSING) return 0;
      _closeFrameSent = true;
      return -1;
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
    if (!_writeQueue.empty() || _state == State::CLOSING) {
      lws_callback_on_writable(wsi);
    }
  }
  if (_state == State::CLOSING) lws_set_timeout(wsi, PENDING_TIMEOUT_CLOSE_SEND, 5);
  return 0;
}

void WebSocketConnection::handlePeerClose(const void* in, size_t len) {
  const auto* p = static_cast<const uint8_t*>(in);
  if (p && len >= 2) {
    _peerCloseCode   = (p[0] << 8) | p[1];
    _peerCloseReason = std::string(reinterpret_cast<const char*>(p + 2), len - 2);
  }
  _state = State::CLOSING;
}

void WebSocketConnection::fireClose(int code, const std::string& reason, bool wasClean) {
  if (_closeFired.exchange(true)) return;
  _state = State::CLOSED;
  if (_onClose) {
    _onClose(code, reason, wasClean);
  } else {
    _closePending = PendingClose{ code, reason, wasClean };
  }
}

void WebSocketConnection::fireError(const std::string& msg) {
  if (_onError) {
    _onError(msg);
  } else {
    _errorPending = msg;
  }
}

void WebSocketConnection::handleClose() {
#if defined(NITRO_WS_TRACING)
  ATrace_beginSection("NitroWS close");
#endif
  _wsi = nullptr;
  if (_peerCloseCode > 0) {
    fireClose(_peerCloseCode, _peerCloseReason, true);
  } else if (_localCloseCode > 0 && _closeFrameSent) {
    fireClose(_localCloseCode, _localCloseReason, true);
  } else {
    // Transport dropped without a close handshake.
    fireClose(1006, "", false);
  }
#if defined(NITRO_WS_TRACING)
  ATrace_endSection();
#endif
}

// lws makes CLIENT_CONNECTION_ERROR and CLIENT_CLOSED mutually exclusive, so
// this is the only place a failed connection can still emit its close event.
void WebSocketConnection::handleError(const char* msg) {
#if defined(NITRO_WS_TRACING)
  ATrace_beginSection("NitroWS error");
#endif
  _state = State::CLOSED;
  _wsi   = nullptr;
  if (!_failureMessage.empty()) {
    fireError(_failureMessage);
  } else {
    fireError(msg ? std::string(msg) : "WebSocket error");
  }
  fireClose(1006, "", false);
#if defined(NITRO_WS_TRACING)
  ATrace_endSection();
#endif
}

void WebSocketConnection::handleRedirect(const std::string& location) {
  if (_state.load() != State::CONNECTING) {
    _failureMessage = "closed before established";
    return;
  }
  if (_redirectCount.fetch_add(1) >= kMaxRedirects) {
    _failureMessage = "too many redirects";
    return;
  }

  std::string url = resolveLocation(_url, location);
  if      (url.rfind("https://", 0) == 0) url = "wss://" + url.substr(8);
  else if (url.rfind("http://",  0) == 0) url = "ws://"  + url.substr(7);
  try {
    parseUrl(url);
  } catch (const std::exception& e) {
    _failureMessage = e.what();
    return;
  }

  _isRedirecting = true;
  _wsi = nullptr;

  std::vector<std::string> protocols;
  std::unordered_map<std::string, std::string> headers;
  {
    std::lock_guard<std::mutex> lock(_pendingConnectMu);
    if (_pendingConnect) {
      protocols = _pendingConnect->protocols;
      headers   = _pendingConnect->headers;
    }
  }
  if (!isSameOrigin(_url, url)) {
    for (auto it = headers.begin(); it != headers.end();) {
      if (equalsIgnoreCase(it->first, "Authorization")) {
        it = headers.erase(it);
      } else {
        ++it;
      }
    }
  }

  startConnect(url, protocols, headers);
}

bool WebSocketConnection::handleAppendHandshakeHeader(uint8_t** p, uint8_t* end, lws* wsi) {
  std::unordered_map<std::string, std::string> headers;
  std::string host;
  bool isWss = false;
  {
    std::lock_guard<std::mutex> lock(_pendingConnectMu);
    if (_pendingConnect) {
      headers = _pendingConnect->headers;
      host = _pendingConnect->host;
      isWss = _pendingConnect->isWss;
    }
  }
  // The TLS handshake is done and nothing is sent yet: check the pins before the headers go out.
  if (isWss) {
    std::vector<std::string_view> chain;
    for (const mbedtls_x509_crt* cert = nitro_ws_peer_chain(wsi); cert != nullptr && cert->raw.p != nullptr;
         cert = cert->next) {
      chain.emplace_back(reinterpret_cast<const char*>(cert->raw.p), cert->raw.len);
    }
    if (auto error = checkPinnedChain(host, chain)) {
      _failureMessage = *error;
      return false;
    }
  }
  for (auto& [key, val] : headers) {
    if (lws_add_http_header_by_name(wsi,
          reinterpret_cast<const uint8_t*>(key.c_str()),
          reinterpret_cast<const uint8_t*>(val.c_str()),
          static_cast<int>(val.size()), p, end) != 0) {
      _failureMessage = "WebSocket handshake headers are too large";
      return false;
    }
  }
  return true;
}

} // namespace margelo::nitro::nitrofetchwebsockets
