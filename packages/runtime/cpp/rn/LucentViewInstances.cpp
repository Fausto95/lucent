#include "LucentViewInstances.h"

#include <jsi/jsi.h>
#include <lucent/jsi/host.h>

#include <cmath>
#include <utility>
#include <vector>

namespace lucent::views {

namespace jsi = facebook::jsi;

namespace {

/// New ids between sweeps of a runtime's entries.
constexpr size_t kSweepEvery = 256;

}  // namespace

InstanceIds& instanceIds() {
  static auto* ids = new InstanceIds();
  return *ids;
}

double InstanceIds::idOf(RuntimeId runtime, const Ref<Object>& object) {
  std::lock_guard<std::mutex> lock(mutex_);
  Runtime& r = runtimes_[runtime];

  if (auto it = r.byObject.find(object.get()); it != r.byObject.end()) {
    auto entry = r.byId.find(it->second);
    // Another object at a freed one's address gets an id of its own.
    if (entry != r.byId.end() && entry->second.lock() == object)
      return static_cast<double>(runtime) * kInstancesPerRuntime + static_cast<double>(it->second);
  }

  if (r.next >= static_cast<uint64_t>(kInstancesPerRuntime)) throwRangeError("Lucent: a runtime gave views more instances than it can number");

  if (++r.sweep >= kSweepEvery) {
    r.sweep = 0;
    sweep(r);
  }

  uint64_t local = r.next++;
  r.byId.insert_or_assign(local, std::weak_ptr<Object>(object));
  r.byObject.insert_or_assign(object.get(), local);

  return static_cast<double>(runtime) * kInstancesPerRuntime + static_cast<double>(local);
}

void InstanceIds::sweep(Runtime& r) {
  std::vector<uint64_t> gone;

  for (const auto& [id, weak] : r.byId)
    if (weak.expired()) gone.push_back(id);

  for (uint64_t id : gone) r.byId.erase(id);

  std::erase_if(r.byObject, [&](const auto& entry) { return !r.byId.count(entry.second); });
}

Ref<Object> InstanceIds::find(double id, std::string& why) const {
  if (!(id >= kInstancesPerRuntime && id < 9007199254740992.0) || std::trunc(id) != id) {
    why = "not an instance's id";
    return nullptr;
  }

  auto runtime = static_cast<RuntimeId>(id / kInstancesPerRuntime);
  auto local = static_cast<uint64_t>(id - static_cast<double>(runtime) * kInstancesPerRuntime);
  std::lock_guard<std::mutex> lock(mutex_);

  if (forgotten_.count(runtime)) {
    why = "an instance of a JavaScript runtime that was torn down";
    return nullptr;
  }

  Ref<Object> object;

  if (auto r = runtimes_.find(runtime); r != runtimes_.end())
    if (auto it = r->second.byId.find(local); it != r->second.byId.end()) object = it->second.lock();

  // Gone, swept or never given: no instance alive has it.
  if (!object) why = "the id of no instance alive";

  return object;
}

void InstanceIds::forget(RuntimeId runtime) {
  std::lock_guard<std::mutex> lock(mutex_);

  runtimes_.erase(runtime);
  forgotten_.insert(runtime);
}

size_t InstanceIds::entries(RuntimeId runtime) const {
  std::lock_guard<std::mutex> lock(mutex_);
  auto it = runtimes_.find(runtime);

  return it == runtimes_.end() ? 0 : it->second.byId.size();
}

namespace {

[[noreturn]] void throwJsTypeError(jsi::Runtime& rt, const std::string& message) {
  jsi::Value error = rt.global().getPropertyAsFunction(rt, "TypeError").callAsConstructor(rt, message);
  throw jsi::JSError(rt, std::move(error));
}

}  // namespace

jsi::Function instanceIdFunction(const std::shared_ptr<js::Host>& host, jsi::Runtime& runtime) {
  std::weak_ptr<js::Host> weak = host;

  return jsi::Function::createFromHostFunction(
      runtime,
      jsi::PropNameID::forAscii(runtime, kInstanceName),
      1,
      [weak](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        auto host = weak.lock();

        if (!host || !host->alive()) throw jsi::JSError(rt, "Lucent: this JavaScript runtime's Lucent host is torn down");

        // A torn-down host's objects throw their own TypeError here.
        Ref<Object> object = count ? js::instanceOf(rt, args[0]) : nullptr;

        if (!object) throwJsTypeError(rt, "Lucent: a view's instance prop takes an instance of a Lucent class");

        return jsi::Value(instanceIds().idOf(host->id(), object));
      });
}

}  // namespace lucent::views
