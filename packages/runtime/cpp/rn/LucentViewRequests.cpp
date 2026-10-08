#include "LucentViewRequests.h"

#include <lucent/jsi/host.h>
#include <lucent/report.h>

#include <mutex>
#include <unordered_map>
#include <utility>

namespace lucent::views {

namespace jsi = facebook::jsi;

namespace {

struct Connection {
  std::weak_ptr<js::Host> host;
  uint64_t settle = 0;
};

/// Each runtime's connection, by its id (the base of its request ids), and
/// the last one made (for ids without a base).
struct Connections {
  std::mutex mutex;
  std::unordered_map<RuntimeId, Connection> byRuntime;
  Connection last;
};

/// Never destroyed: answers may come during static destruction.
Connections& connections() {
  static auto* c = new Connections();
  return *c;
}

}  // namespace

double requestBase(RuntimeId runtime) { return static_cast<double>(runtime) * kRequestsPerRuntime; }

Requester Requester::current() {
  Connections& c = connections();
  std::lock_guard<std::mutex> lock(c.mutex);

  return Requester(c.last.host, c.last.settle);
}

Requester Requester::forRequest(double id) const {
  if (!(id >= kRequestsPerRuntime)) return *this;

  auto runtime = static_cast<RuntimeId>(id / kRequestsPerRuntime);
  Connections& c = connections();
  std::lock_guard<std::mutex> lock(c.mutex);

  auto it = c.byRuntime.find(runtime);
  if (it == c.byRuntime.end()) return Requester();

  return Requester(it->second.host, it->second.settle);
}

Requester::operator bool() const {
  auto host = host_.lock();

  return host && host->alive();
}

void Requester::settle(double id, std::function<void(jsi::Runtime&, jsi::Function&)> call) const {
  // An id with its runtime's base answers in that runtime, whichever was
  // current when the command came.
  Requester to = forRequest(id);
  auto host = to.host_.lock();

  if (!host) return;

  host->postToJs([weak = to.host_, settle = to.settle_, id, call = std::move(call)](jsi::Runtime& runtime) {
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

double connectRequests(const std::shared_ptr<js::Host>& host, jsi::Runtime& runtime, jsi::Function settle) {
  if (!host->alive()) throw jsi::JSError(runtime, "Lucent: this JavaScript runtime's Lucent host is torn down");

  uint64_t id = host->retain(runtime, std::move(settle));
  Connection previous;

  {
    Connections& c = connections();
    std::lock_guard<std::mutex> lock(c.mutex);

    // Runtimes torn down are forgotten: their answers go nowhere.
    std::erase_if(c.byRuntime, [](const auto& entry) {
      auto h = entry.second.host.lock();
      return !h || !h->alive();
    });

    previous = std::exchange(c.byRuntime[host->id()], Connection{host, id});
    c.last = Connection{host, id};
  }

  // The same runtime connecting again (a second views runtime): its old function goes.
  if (auto old = previous.host.lock(); old == host && previous.settle != id) host->release(previous.settle);

  return requestBase(host->id());
}

}  // namespace lucent::views
