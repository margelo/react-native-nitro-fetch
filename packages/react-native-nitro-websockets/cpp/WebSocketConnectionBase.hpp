//
//  WebSocketConnectionBase.hpp
//  Pods
//
//  Created by Ritesh Shukla on 23.03.26.
//

#pragma once

#include <string>
#include <vector>
#include <unordered_map>
#include <functional>
#include <memory>
#include <cstdint>

namespace margelo::nitro::nitrofetchwebsockets {

class WebSocketConnectionBase : public std::enable_shared_from_this<WebSocketConnectionBase> {
public:
  enum class State { CONNECTING = 0, OPEN = 1, CLOSING = 2, CLOSED = 3 };

  using OnOpen    = std::function<void()>;
  using OnMessage = std::function<void(const uint8_t* data, size_t len, bool isBinary)>;
  using OnClose   = std::function<void(int code, const std::string& reason, bool wasClean)>;
  using OnError   = std::function<void(const std::string& msg)>;

  virtual ~WebSocketConnectionBase() = default;

  virtual void connect(const std::string& url,
                       const std::vector<std::string>& protocols,
                       const std::unordered_map<std::string, std::string>& headers) = 0;
  virtual void close(int code, const std::string& reason) = 0;
  virtual void send(const std::string& data) = 0;
  virtual void sendBinary(const uint8_t* data, size_t len) = 0;

  virtual State state() const = 0;
  virtual std::string url() const = 0;
  virtual std::string protocol() const = 0;
  virtual std::string extensions() const = 0;
  virtual size_t bufferedAmount() const = 0;

  virtual void setOnOpen(OnOpen cb) = 0;
  virtual void setOnMessage(OnMessage cb) = 0;
  virtual void setOnClose(OnClose cb) = 0;
  virtual void setOnError(OnError cb) = 0;
};

} // namespace margelo::nitro::nitrofetchwebsockets
