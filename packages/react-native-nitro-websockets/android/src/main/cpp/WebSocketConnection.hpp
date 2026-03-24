//
//  WebSocketConnection.hpp
//  Pods
//
//  Created by Ritesh Shukla on 20.03.26.
//

#pragma once

#include "WebSocketConnectionBase.hpp"

#include <libwebsockets.h>
#include <deque>
#include <mutex>
#include <atomic>
#include <optional>

namespace margelo::nitro::nitrofetchwebsockets {


class WebSocketConnection : public WebSocketConnectionBase {
public:
  WebSocketConnection();
  ~WebSocketConnection() override;

  WebSocketConnection(const WebSocketConnection&) = delete;
  WebSocketConnection& operator=(const WebSocketConnection&) = delete;

  void connect(const std::string& url,
               const std::vector<std::string>& protocols,
               const std::unordered_map<std::string, std::string>& headers) override;
  void close(int code, const std::string& reason) override;
  void send(const std::string& data) override;
  void sendBinary(const uint8_t* data, size_t len) override;

  State state() const override { return _state; }
  std::string url() const override { return _url; }
  std::string protocol() const override { return _negotiatedProtocol; }
  std::string extensions() const override { return _extensions; }
  size_t bufferedAmount() const override { return _bufferedAmount.load(); }

  void setOnOpen(OnOpen cb) override;
  void setOnMessage(OnMessage cb) override;
  void setOnClose(OnClose cb) override;
  void setOnError(OnError cb) override;

  // lws callback handlers (internal, not part of the base interface)
  void handleEstablished(lws* wsi);
  void handleReceive(const void* in, size_t len, bool isBinary);
  int  handleWriteable(lws* wsi);
  void handleClose(int code, const char* reason, size_t len);
  void handleError(const char* msg);
  void handleAppendHandshakeHeader(uint8_t** p, uint8_t* end, lws* wsi);
  void handleRedirect(const std::string& location);
  bool consumeRedirectFlag() { return _isRedirecting.exchange(false); }

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
  std::atomic<bool> _isRedirecting{false};
  std::atomic<int>  _redirectCount{0};
  static constexpr int kMaxRedirects = 5;

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
    std::vector<std::string> protocols;
    bool isWss;
    std::unordered_map<std::string, std::string> headers;
  };
  std::optional<PendingConnect> _pendingConnect;
  std::mutex _pendingConnectMu;
};

} // namespace margelo::nitro::nitrofetchwebsockets
