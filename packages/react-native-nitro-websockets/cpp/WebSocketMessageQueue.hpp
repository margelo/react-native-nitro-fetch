#pragma once

#include "HybridWebSocketMessageEvent.hpp"

#include <NitroModules/JSIConverter.hpp>
#include <cstdint>
#include <memory>
#include <mutex>
#include <optional>
#include <string>
#include <variant>
#include <vector>

namespace margelo::nitro::nitrofetchwebsockets {

class WebSocketMessageQueue {
public:
  struct Text {
    std::vector<uint8_t> bytes;
    bool ascii;
  };
  using Item = std::variant<Text, HybridWebSocketMessageEvent>;

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
  using Queue = nitrofetchwebsockets::WebSocketMessageQueue;
  using Event = nitrofetchwebsockets::HybridWebSocketMessageEvent;
  using Values = std::vector<std::variant<std::string, Event>>;

  static inline Queue fromJSI(jsi::Runtime& runtime, const jsi::Value& arg) {
    Values values = JSIConverter<Values>::fromJSI(runtime, arg);
    std::vector<Queue::Item> items;
    items.reserve(values.size());
    for (auto& value : values) {
      if (auto* text = std::get_if<std::string>(&value)) {
        items.emplace_back(Queue::Text{ std::vector<uint8_t>(text->begin(), text->end()), false });
      } else {
        items.emplace_back(std::get<Event>(std::move(value)));
      }
    }
    return Queue(std::move(items));
  }
  static inline jsi::Value toJSI(jsi::Runtime& runtime, const Queue& queue) {
    std::vector<Queue::Item> items = queue.drain();
    jsi::Array array(runtime, items.size());
    for (size_t i = 0; i < items.size(); i++) {
      if (auto* text = std::get_if<Queue::Text>(&items[i])) {
        array.setValueAtIndex(runtime, i,
                              text->ascii ? jsi::String::createFromAscii(runtime, reinterpret_cast<const char*>(text->bytes.data()), text->bytes.size())
                                          : jsi::String::createFromUtf8(runtime, text->bytes.data(), text->bytes.size()));
      } else {
        array.setValueAtIndex(runtime, i, JSIConverter<Event>::toJSI(runtime, std::get<Event>(items[i])));
      }
    }
    return array;
  }
  static inline bool canConvert(jsi::Runtime& runtime, const jsi::Value& value) {
    return JSIConverter<Values>::canConvert(runtime, value);
  }
};

} // namespace margelo::nitro
