#pragma once

#include "HybridWebSocketMessageEvent.hpp"

#include <NitroModules/JSIConverter.hpp>
#include <NitroModules/ThreadPool.hpp>
#include <atomic>
#include <cstdint>
#include <deque>
#include <functional>
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
  using Deliver = std::function<void(WebSocketMessageQueue)>;

  WebSocketMessageQueue() : _state(std::make_shared<State>()) {}
  explicit WebSocketMessageQueue(std::vector<Item>&& items) : _state(std::make_shared<State>()) {
    for (auto& item : items) _state->entries.push_back(Message{ std::move(item), nullptr });
  }
  WebSocketMessageQueue(const WebSocketMessageQueue&) = default;
  WebSocketMessageQueue(WebSocketMessageQueue&&) noexcept = default;
  WebSocketMessageQueue& operator=(const WebSocketMessageQueue&) = delete;
  WebSocketMessageQueue& operator=(WebSocketMessageQueue&&) = delete;
  ~WebSocketMessageQueue() {
    if (!_delivery || _delivery->delivered.load(std::memory_order_acquire) || posting() == _delivery.get()) return;
    std::lock_guard<std::mutex> lock(_state->mutex);
    if (!_delivery->delivered.load(std::memory_order_relaxed)) _delivery->dropped = true;
  }

  void push(Item&& item, const std::shared_ptr<Deliver>& deliver) const {
    enqueue(Message{ std::move(item), deliver });
  }

  void push(std::function<void()>&& event) const {
    enqueue(std::move(event));
  }

  std::optional<Item> next() const {
    std::unique_lock<std::mutex> lock(_state->mutex);
    if (_delivery && _delivery->delivered.load(std::memory_order_relaxed)) return std::nullopt;
    std::optional<Item> item;
    if (!_state->entries.empty()) {
      if (auto* message = std::get_if<Message>(&_state->entries.front())) {
        item = std::move(message->item);
        _state->entries.pop_front();
      }
    }
    if (_delivery) {
      _delivery->delivered.store(true, std::memory_order_release);
      pump(lock);
    }
    return item;
  }

private:
  struct Message {
    Item item;
    std::shared_ptr<Deliver> deliver;
  };
  using Entry = std::variant<Message, std::function<void()>>;
  struct State {
    std::mutex mutex;
    std::deque<Entry> entries;
    bool scheduled = false;
  };
  struct Delivery {
    explicit Delivery(std::shared_ptr<State> state) : state(std::move(state)) {}
    ~Delivery() {
      std::unique_lock<std::mutex> lock(state->mutex);
      if (delivered.load(std::memory_order_relaxed)) return;
      if (!dropped) {
        state->scheduled = false;
        return;
      }
      lock.unlock();
      ThreadPool::shared().run([queue = WebSocketMessageQueue(state, nullptr)] {
        std::unique_lock<std::mutex> lock(queue._state->mutex);
        queue.pump(lock);
      });
    }
    std::shared_ptr<State> state;
    std::atomic<bool> delivered{ false };
    bool dropped = false;
  };

  static const Delivery*& posting() {
    thread_local const Delivery* delivery = nullptr;
    return delivery;
  }

  WebSocketMessageQueue(std::shared_ptr<State> state, std::shared_ptr<Delivery> delivery)
      : _state(std::move(state)), _delivery(std::move(delivery)) {}

  void enqueue(Entry&& entry) const {
    std::unique_lock<std::mutex> lock(_state->mutex);
    _state->entries.push_back(std::move(entry));
    if (_state->scheduled) return;
    _state->scheduled = true;
    pump(lock);
  }

  void pump(std::unique_lock<std::mutex>& lock) const {
    while (!_state->entries.empty()) {
      if (auto* message = std::get_if<Message>(&_state->entries.front())) {
        std::shared_ptr<Deliver> deliver = message->deliver;
        auto delivery = std::make_shared<Delivery>(_state);
        lock.unlock();
        posting() = delivery.get();
        (*deliver)(WebSocketMessageQueue(_state, std::move(delivery)));
        posting() = nullptr;
        return;
      }
      std::function<void()> event = std::get<std::function<void()>>(std::move(_state->entries.front()));
      _state->entries.pop_front();
      lock.unlock();
      event();
      event = nullptr;
      lock.lock();
    }
    _state->scheduled = false;
  }

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
    std::optional<Queue::Item> item = queue.next();
    if (!item) return jsi::Array(runtime, 0);
    jsi::Array array(runtime, 1);
    if (auto* text = std::get_if<Queue::Text>(&*item)) {
      const char* chars = reinterpret_cast<const char*>(text->bytes.data());
      array.setValueAtIndex(runtime, 0,
                            text->ascii ? jsi::String::createFromAscii(runtime, chars, text->bytes.size())
                                        : jsi::String::createFromUtf8(runtime, text->bytes.data(), text->bytes.size()));
    } else {
      array.setValueAtIndex(runtime, 0, JSIConverter<Event>::toJSI(runtime, std::get<Event>(*item)));
    }
    return array;
  }
  static inline bool canConvert(jsi::Runtime& runtime, const jsi::Value& value) {
    return JSIConverter<Values>::canConvert(runtime, value);
  }
};

} // namespace margelo::nitro
