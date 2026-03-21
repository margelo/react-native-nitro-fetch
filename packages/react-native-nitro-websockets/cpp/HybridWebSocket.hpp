//
//  HybridWebSocket.hpp
//  Pods
//
//  Created by Ritesh Shukla on 20.03.26.
//

#pragma once

#include "HybridHybridWebSocketSpec.hpp"
#include "WebSocketConnection.hpp"

#include <functional>
#include <optional>
#include <memory>

namespace margelo::nitro::nitrofetchwebsockets {


class HybridWebSocket : public HybridHybridWebSocketSpec {
public:
  HybridWebSocket();
  ~HybridWebSocket() override;


  WebSocketReadyState getReadyState() override;
  std::string getUrl() override;
  double getBufferedAmount() override;
  std::string getProtocol() override;
  std::string getExtensions() override;


  std::optional<std::function<void()>> getOnOpen() override;
  void setOnOpen(const std::optional<std::function<void()>>& cb) override;

  std::optional<std::function<void(const WebSocketMessageEvent&)>> getOnMessage() override;
  void setOnMessage(const std::optional<std::function<void(const WebSocketMessageEvent&)>>& cb) override;

  std::optional<std::function<void(const WebSocketCloseEvent&)>> getOnClose() override;
  void setOnClose(const std::optional<std::function<void(const WebSocketCloseEvent&)>>& cb) override;

  std::optional<std::function<void(const std::string&)>> getOnError() override;
  void setOnError(const std::optional<std::function<void(const std::string&)>>& cb) override;


  void connect(const std::string& url,
               const std::vector<std::string>& protocols,
               const std::unordered_map<std::string, std::string>& headers) override;

  void close(double code, const std::string& reason) override;
  void send(const std::string& data) override;
  void sendBinary(const std::shared_ptr<ArrayBuffer>& data) override;

  inline static const char* TAG = "WebSocket";

private:

  void bindCallbacks();

  std::shared_ptr<WebSocketConnection> _conn;
  std::optional<std::function<void()>> _onOpen;
  std::optional<std::function<void(const WebSocketMessageEvent&)>> _onMessage;
  std::optional<std::function<void(const WebSocketCloseEvent&)>> _onClose;
  std::optional<std::function<void(const std::string&)>> _onError;
};

} // namespace margelo::nitro::nitrofetchwebsockets
