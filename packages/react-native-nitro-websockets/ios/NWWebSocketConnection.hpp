

#pragma once

#include "WebSocketConnectionBase.hpp"

#include <deque>
#include <mutex>
#include <atomic>
#include <memory>

namespace margelo::nitro::nitrofetchwebsockets {

class NWWebSocketConnection : public WebSocketConnectionBase {
public:
  NWWebSocketConnection();
  ~NWWebSocketConnection() override;

  NWWebSocketConnection(const NWWebSocketConnection&) = delete;
  NWWebSocketConnection& operator=(const NWWebSocketConnection&) = delete;

  void connect(const std::string& url,
               const std::vector<std::string>& protocols,
               const std::unordered_map<std::string, std::string>& headers) override;
  void close(int code, const std::string& reason) override;
  void send(const std::string& data) override;
  void sendBinary(const uint8_t* data, size_t len) override;

  State state() const override { return _state.load(std::memory_order_acquire); }
  std::string url() const override;
  std::string protocol() const override;
  std::string extensions() const override;
  size_t bufferedAmount() const override { return _bufferedAmount.load(std::memory_order_relaxed); }

  void setOnOpen(OnOpen cb) override;
  void setOnMessage(OnMessage cb) override;
  void setOnClose(OnClose cb) override;
  void setOnError(OnError cb) override;

private:
  struct Impl;
  std::unique_ptr<Impl> _impl;

  std::string _url;
  std::string _negotiatedProtocol;
  std::mutex _strMu;

  std::atomic<State> _state{State::CONNECTING};
  std::atomic<size_t> _bufferedAmount{0};

  OnOpen    _onOpen;
  OnMessage _onMessage;
  OnClose   _onClose;
  OnError   _onError;
  std::mutex _cbMu;

  std::atomic<bool> _openFired{false};
  std::atomic<bool> _closeFired{false};

  struct BufferedMessage { std::vector<uint8_t> data; bool isBinary; };
  std::deque<BufferedMessage> _msgBuffer;
  std::mutex _msgMu;

  int _receivedCloseCode{1005};
  std::string _receivedCloseReason;

  void scheduleReceive();
  void fireClose(int code, const std::string& reason, bool wasClean);
  void fireError(const std::string& msg);
};

std::shared_ptr<WebSocketConnectionBase> createNWConnection();

} // namespace margelo::nitro::nitrofetchwebsockets
