#pragma once

#include "HybridWebSocketMessageEvent.hpp"

#include <NitroModules/JSIConverter.hpp>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <variant>
#include <vector>

namespace margelo::nitro::nitrofetchwebsockets {

class WebSocketMessageQueue {
public:
  using Item = std::variant<std::string, HybridWebSocketMessageEvent>;

  WebSocketMessageQueue() : _state(std::make_shared<State>()) {}
  explicit WebSocketMessageQueue(std::vector<Item>&& items) : WebSocketMessageQueue() {
    _state->items = std::move(items);
  }

  std::optional<WebSocketMessageQueue> push(Item&& item) const {
    std::lock_guard<std::mutex> lock(_state->mutex);
    _state->items.push_back(std::move(item));
    if (_state->scheduled) return std::nullopt;
    _state->scheduled = true;
    return WebSocketMessageQueue(_state, std::make_shared<Delivery>(_state));
  }

  std::vector<Item> drain() const {
    std::vector<Item> items;
    std::lock_guard<std::mutex> lock(_state->mutex);
    items.swap(_state->items);
    _state->scheduled = false;
    if (_delivery) _delivery->drained = true;
    return items;
  }

private:
  struct State {
    std::mutex mutex;
    std::vector<Item> items;
    bool scheduled = false;
  };
  struct Delivery {
    explicit Delivery(std::shared_ptr<State> state) : state(std::move(state)) {}
    ~Delivery() {
      std::lock_guard<std::mutex> lock(state->mutex);
      if (!drained) state->scheduled = false;
    }
    std::shared_ptr<State> state;
    bool drained = false;
  };

  WebSocketMessageQueue(std::shared_ptr<State> state, std::shared_ptr<Delivery> delivery)
      : _state(std::move(state)), _delivery(std::move(delivery)) {}

  std::shared_ptr<State> _state;
  std::shared_ptr<Delivery> _delivery;
};

} // namespace margelo::nitro::nitrofetchwebsockets

namespace margelo::nitro {

template <>
struct JSIConverter<nitrofetchwebsockets::WebSocketMessageQueue> final {
  using Items = std::vector<nitrofetchwebsockets::WebSocketMessageQueue::Item>;

  static inline nitrofetchwebsockets::WebSocketMessageQueue fromJSI(jsi::Runtime& runtime, const jsi::Value& arg) {
    return nitrofetchwebsockets::WebSocketMessageQueue(JSIConverter<Items>::fromJSI(runtime, arg));
  }
  static inline jsi::Value toJSI(jsi::Runtime& runtime, const nitrofetchwebsockets::WebSocketMessageQueue& queue) {
    return JSIConverter<Items>::toJSI(runtime, queue.drain());
  }
  static inline bool canConvert(jsi::Runtime& runtime, const jsi::Value& value) {
    return JSIConverter<Items>::canConvert(runtime, value);
  }
};

} // namespace margelo::nitro
