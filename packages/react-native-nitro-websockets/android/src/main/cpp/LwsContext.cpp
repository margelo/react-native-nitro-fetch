//
//  LwsContext.cpp
//  Pods
//
//  Created by Ritesh Shukla on 20.03.26.
//

#include "LwsContext.hpp"
#include "CaBundle.hpp"

#include <libwebsockets.h>
#include <stdexcept>
#include <string>

namespace margelo::nitro::nitrofetchwebsockets {


LwsContext& LwsContext::instance() {
  static LwsContext inst;
  return inst;
}


LwsContext::LwsContext() {
  lws_set_log_level(LLL_ERR | LLL_WARN, nullptr);

  static const lws_protocols protocols[] = {
    { "nitro-ws", nitroWsCallback, 0, 65536, 0, nullptr, 0 },
    LWS_PROTOCOL_LIST_TERM
  };

  lws_context_creation_info info = {};
  info.port     = CONTEXT_PORT_NO_LISTEN;
  info.protocols = protocols;
  info.options  = LWS_SERVER_OPTION_DO_SSL_GLOBAL_INIT;
  info.gid      = -1;
  info.uid      = -1;

#if defined(__ANDROID__) || defined(__APPLE__)
  info.client_ssl_ca_mem     = kCacertPemData;
  info.client_ssl_ca_mem_len = kCacertPemLen;
#endif

  _ctx = lws_create_context(&info);
  if (_ctx == nullptr) {
    throw std::runtime_error("Failed to create lws_context");
  }

  _serviceThread = std::thread([this]() { loop(); });
}

LwsContext::~LwsContext() {
  _running = false;
  wakeup();
  if (_serviceThread.joinable()) {
    _serviceThread.join();
  }
  lws_context_destroy(_ctx);
}



void LwsContext::schedule(std::function<void()> op) {
  {
    std::lock_guard<std::mutex> lock(_mu);
    _pending.push_back(std::move(op));
  }
  wakeup();
}

void LwsContext::wakeup() {
  lws_cancel_service(_ctx);
}


void LwsContext::loop() {
  while (_running) {
    // Drain pending operations before each service call
    std::vector<std::function<void()>> ops;
    {
      std::lock_guard<std::mutex> lock(_mu);
      ops.swap(_pending);
    }
    for (auto& fn : ops) {
      fn();
    }

    lws_service(_ctx, 50);
  }
}

} // namespace margelo::nitro::nitrofetchwebsockets
