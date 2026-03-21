//
//  WebSocketPrewarmer.hpp
//  Pods
//
//  Created by Ritesh Shukla on 20.03.26.
//

#pragma once

#include "WebSocketConnection.hpp"

#include <string>
#include <vector>
#include <unordered_map>
#include <memory>
#include <mutex>

namespace margelo::nitro::nitrofetchwebsockets {


class WebSocketPrewarmer {
public:
  static WebSocketPrewarmer& instance();

 
  void preConnect(const std::string& url,
                  const std::vector<std::string>& protocols,
                  const std::unordered_map<std::string, std::string>& headers);


  std::shared_ptr<WebSocketConnection> tryGet(const std::string& url);

private:
  WebSocketPrewarmer() = default;

  std::mutex _mu;
  std::unordered_map<std::string, std::shared_ptr<WebSocketConnection>> _entries;
};

} // namespace margelo::nitro::nitrofetchwebsockets
