//
//  WebSocketConnection.hpp
//  Pods
//
//  Created by Ritesh Shukla on 20.03.26.
//

#pragma once

#include <libwebsockets.h>
#include <deque>
#include <mutex>
#include <atomic>
#include <string>
#include <vector>
#include <functional>
#include <optional>
#include <memory>
#include <unordered_map>

namespace margelo::nitro::nitrofetchwebsockets {


class WebSocketConnection : public std::enable_shared_from_this<WebSocketConnection> {
public:
  // ── Ready state (mirrors the browser WebSocket spec) ─────────────────────
  enum class State { CONNECTING = 0, OPEN = 1, CLOSING = 2, CLOSED = 3 };

  // ── Callback types ────────────────────────────────────────────────────────
  using OnOpen    = std::function<void()>;
  using OnMessage = std::function<void(const uint8_t* data, size_t len, bool isBinary)>;
  using OnClose   = std::function<void(int code, const std::string& reason, bool wasClean)>;
  using OnError   = std::function<void(const std::string& msg)>;

  WebSocketConnection();
  ~WebSocketConnection();

  WebSocketConnection(const WebSocketConnection&) = delete;
  WebSocketConnection& operator=(const WebSocketConnection&) = delete;


  void connect(const std::string& url,
               const std::vector<std::string>& protocols,
               const std::unordered_map<std::string, std::string>& headers);

  void close(int code, const std::string& reason);
  void send(const std::string& data);
  void sendBinary(const uint8_t* data, size_t len);


  State state() const { return _state; }
  const std::string& url()        const { return _url; }
  const std::string& protocol()   const { return _negotiatedProtocol; }
  const std::string& extensions() const { return _extensions; }
  size_t bufferedAmount() const { return _bufferedAmount.load(); }


  void setOnOpen(OnOpen cb);
  void setOnMessage(OnMessage cb);
  void setOnClose(OnClose cb);
  void setOnError(OnError cb);


  void handleEstablished(lws* wsi);
  void handleReceive(const void* in, size_t len, bool isBinary);
  void handleWriteable(lws* wsi);
  void handleClose(int code, const char* reason, size_t len);
  void handleError(const char* msg);
  void handleAppendHandshakeHeader(uint8_t** p, uint8_t* end, lws* wsi);

private:
  void requestWrite();

  lws*        _wsi = nullptr;
  std::string _url;
  std::string _negotiatedProtocol;
  std::string _extensions;
  State       _state = State::CONNECTING;

  OnOpen    _onOpen;
  OnMessage _onMessage;
  OnClose   _onClose;
  OnError   _onError;

  std::atomic<bool> _openFired{false};

  struct BufferedMessage { std::vector<uint8_t> data; bool isBinary; };
  std::deque<BufferedMessage> _msgBuffer;
  std::mutex _msgMu;

  struct OutMessage { std::vector<uint8_t> data; bool isBinary; };
  std::deque<OutMessage> _writeQueue;
  std::mutex _writeMu;
  std::atomic<size_t> _bufferedAmount{0};

  struct PendingConnect {
    std::string host;
    int port;
    std::string path;
    std::string protocolStr;
    bool isWss;
    std::unordered_map<std::string, std::string> headers;
  };
  std::optional<PendingConnect> _pendingConnect;
  std::mutex _pendingConnectMu;
};

} // namespace margelo::nitro::nitrofetchwebsockets
