#include "LucentViewRequests.h"

#include <lucent/jsi/host.h>
#include <lucent/report.h>

#include <mutex>
#include <utility>

namespace lucent::views {

namespace jsi = facebook::jsi;

namespace {

struct Connection {
  std::weak_ptr<js::Host> host;
  uint64_t settle = 0;
};

std::mutex& connectionMutex() {
  static std::mutex mutex;
  return mutex;
}

Connection& connection() {
  static Connection current;
  return current;
}

}  // namespace

Requester Requester::current() {
  std::lock_guard<std::mutex> lock(connectionMutex());

  return Requester(connection().host, connection().settle);
}

Requester::operator bool() const {
  auto host = host_.lock();

  return host && host->alive();
}

void Requester::settle(double id, std::function<void(jsi::Runtime&, jsi::Function&)> call) const {
  auto host = host_.lock();

  if (!host) return;

  host->postToJs([weak = host_, settle = settle_, id, call = std::move(call)](jsi::Runtime& runtime) {
    auto host = weak.lock();
    jsi::Function* fn = host ? host->retained(settle) : nullptr;

    if (!fn) return;

    try {
      call(runtime, *fn);
    } catch (const std::exception& e) {
      logError((std::string("[lucent] answering view request ") + std::to_string(id) + ": " + e.what()).c_str());
    }
  });
}

void Requester::resolve(double id, AnswerValue value) const {
  settle(id, [id, value = std::move(value)](jsi::Runtime& runtime, jsi::Function& fn) {
    fn.call(runtime, jsi::Value(id), jsi::Value::null(), value(runtime));
  });
}

void Requester::reject(double id, std::string message) const {
  settle(id, [id, message = std::move(message)](jsi::Runtime& runtime, jsi::Function& fn) {
    fn.call(runtime, jsi::Value(id), jsi::String::createFromUtf8(runtime, message));
  });
}

void connectRequests(const std::shared_ptr<js::Host>& host, jsi::Runtime& runtime, jsi::Function settle) {
  if (!host->alive()) throw jsi::JSError(runtime, "Lucent: this JavaScript runtime's Lucent host is torn down");

  uint64_t id = host->retain(runtime, std::move(settle));
  Connection previous;

  {
    std::lock_guard<std::mutex> lock(connectionMutex());

    previous = std::exchange(connection(), Connection{host, id});
  }

  // The same runtime connecting again (a second views runtime): its old function goes.
  if (auto old = previous.host.lock(); old == host && previous.settle != id) host->release(previous.settle);
}

}  // namespace lucent::views
