

#pragma once

#include "WebSocketConnectionBase.hpp"

#include <mutex>
#include <atomic>
#include <memory>

namespace margelo::nitro::nitrofetchwebsockets {

class NWStreamWebSocketConnection : public WebSocketConnectionBase {
public:
  NWStreamWebSocketConnection();
  ~NWStreamWebSocketConnection() override;

  NWStreamWebSocketConnection(const NWStreamWebSocketConnection&) = delete;
  NWStreamWebSocketConnection& operator=(const NWStreamWebSocketConnection&) = delete;

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

  void sendMessage(uint8_t opcode, const uint8_t* data, size_t len);

  std::string _url;
  std::string _negotiatedProtocol;
  std::string _extensions;
  mutable std::mutex _strMu;

  std::atomic<State> _state{State::CONNECTING};
  std::atomic<size_t> _bufferedAmount{0};
  std::mutex _sendMu;
};

std::shared_ptr<WebSocketConnectionBase> createNWStreamConnection();

} // namespace margelo::nitro::nitrofetchwebsockets
