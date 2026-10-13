// Lucent runtime — instances of exported classes as view props.
//
// A component's proxy sends an instance prop as a number: its runtime's
// base (the runtime's id times kInstancesPerRuntime) plus the instance's
// number in that runtime, which the Lucent module's __lucentViewInstance
// gives JavaScript (instanceIdFunction below). The same instance has the
// same id while it lives, so a commit that passes it again changes nothing.
//
// The commit's props find the instance as React Native parses them,
// synchronously in the JavaScript call that commits, while JavaScript holds
// it; from then on they hold it (Instance), and the mount showing it holds
// it too. So the instance lives until its JavaScript object, every commit
// and mount that has it, and Lucent code let it go. The ids hold nothing:
// an id whose instance is gone, or whose runtime was torn down (a reload),
// is no instance's, and reads as missing.
#pragma once

#include <lucent/core.h>
#include <lucent/scope.h>

#include <cstddef>
#include <cstdint>
#include <memory>
#include <mutex>
#include <string>
#include <unordered_map>
#include <unordered_set>

namespace facebook::jsi {
class Function;
class Runtime;
}  // namespace facebook::jsi

namespace lucent::js {
class Host;
}

namespace lucent::views {

/// How many instance ids each runtime has: its ids start at its id times this.
inline constexpr double kInstancesPerRuntime = 4294967296.0;

/** An instance prop as a commit's props hold it: its id, and the instance, held. */
struct Instance {
  double id = 0;
  Ref<Object> object;
};

/** Which instance each id names. Any thread. */
class InstanceIds {
 public:
  /// The id of `object` in runtime `runtime`: the same each time while it lives.
  double idOf(RuntimeId runtime, const Ref<Object>& object);

  /// The instance `id` names, or null, with why in `why`: its instance is
  /// gone, its runtime was torn down, or it was never an id.
  Ref<Object> find(double id, std::string& why) const;

  /// Runtime `runtime` was torn down: its ids name nothing from now on.
  void forget(RuntimeId runtime);

  /// The ids runtime `runtime` holds an entry for, live or not yet swept (tests).
  size_t entries(RuntimeId runtime) const;

 private:
  struct Runtime {
    uint64_t next = 1;
    std::unordered_map<uint64_t, std::weak_ptr<Object>> byId;
    std::unordered_map<const Object*, uint64_t> byObject;
    size_t sweep = 0;
  };

  /// Drops the entries of instances that are gone.
  static void sweep(Runtime& r);

  mutable std::mutex mutex_;
  std::unordered_map<RuntimeId, Runtime> runtimes_;
  /// Runtimes torn down: their ids are reported as such.
  std::unordered_set<RuntimeId> forgotten_;
};

/// The process's registry. Never destroyed: commits may be released during static destruction.
InstanceIds& instanceIds();

/// The name the Lucent module gives the function JavaScript asks an instance's id with.
inline constexpr const char* kInstanceName = "__lucentViewInstance";

/// `__lucentViewInstance(value)`: the id of `value`, an instance of a
/// Lucent class this host gave JavaScript; a TypeError for anything else.
/// On the JavaScript thread.
facebook::jsi::Function instanceIdFunction(const std::shared_ptr<js::Host>& host, facebook::jsi::Runtime& runtime);

}  // namespace lucent::views
