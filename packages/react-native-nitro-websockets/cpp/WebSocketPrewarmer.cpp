//
//  WebSocketPrewarmer.cpp
//  Pods
//
//  Created by Ritesh Shukla on 20.03.26.
//

#include "WebSocketPrewarmer.hpp"

#if defined(__APPLE__)
namespace margelo::nitro::nitrofetchwebsockets {
  std::shared_ptr<WebSocketConnectionBase> createNWConnection();
}
#else
#include "WebSocketConnection.hpp"
#include "LwsContext.hpp"
#endif

namespace margelo::nitro::nitrofetchwebsockets {

static std::shared_ptr<WebSocketConnectionBase> createPlatformConnection() {
#if defined(__APPLE__)
  return createNWConnection();
#else
  return std::make_shared<WebSocketConnection>();
#endif
}

WebSocketPrewarmer& WebSocketPrewarmer::instance() {
  static WebSocketPrewarmer inst;
  return inst;
}

void WebSocketPrewarmer::preConnect(
    const std::string& url,
    const std::vector<std::string>& protocols,
    const std::unordered_map<std::string, std::string>& headers) {
#if !defined(__APPLE__)
  LwsContext::instance();
#endif

  auto conn = createPlatformConnection();
  conn->connect(url, protocols, headers);

  std::lock_guard<std::mutex> lock(_mu);
  _entries[url] = std::move(conn);
}

std::shared_ptr<WebSocketConnectionBase> WebSocketPrewarmer::tryGet(const std::string& url) {
  std::lock_guard<std::mutex> lock(_mu);
  auto it = _entries.find(url);
  if (it == _entries.end()) return nullptr;
  auto conn = std::move(it->second);
  _entries.erase(it);
  return conn;
}

} // namespace margelo::nitro::nitrofetchwebsockets
