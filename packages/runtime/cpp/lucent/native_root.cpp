#include "native_root.h"

#include <condition_variable>
#include <utility>
#include <vector>

#include "hooks.h"
#include "report.h"
#include "scope.h"

namespace lucent {

namespace {

/// Module state's generation: none, starting on some thread, or lasting.
struct ModuleState {
  std::mutex m;
  std::condition_variable changed;
  uint64_t generation = 0;
  uint64_t last = 0;
  bool starting = false;
  size_t holds = 0;
};

/// Never destroyed: a hold released during static destruction needs it.
ModuleState& state() {
  static auto* s = new ModuleState();
  return *s;
}

}  // namespace

bool ensureModuleState(ModuleInitializer init) {
  ModuleState& s = state();
  {
    std::unique_lock<std::mutex> g(s.m);
    s.changed.wait(g, [&] { return !s.starting; });
    if (s.generation) return false;

    s.starting = true;
    s.generation = ++s.last;
  }

  // Outside the lock: each module's top level takes its actor, and may
  // register destroy hooks under the generation starting now.
  try {
    init();
  } catch (...) {
    reportUncaught(std::current_exception(), "module initialization");
  }

  {
    std::lock_guard<std::mutex> g(s.m);
    s.starting = false;
  }
  s.changed.notify_all();
  return true;
}

uint64_t moduleGeneration() {
  ModuleState& s = state();
  std::lock_guard<std::mutex> g(s.m);
  return s.generation;
}

bool endModuleStateUnlessHeld(RuntimeId leaving) {
  ModuleState& s = state();
  uint64_t ending;
  {
    std::unique_lock<std::mutex> g(s.m);
    s.changed.wait(g, [&] { return !s.starting; });
    if (!s.generation || s.holds || otherRuntimes(leaving)) return false;

    ending = s.generation;
    s.generation = 0;
  }

  // The state's hooks, which see it still (the next use initializes it again).
  runDestroyHooks(ending);
  return true;
}

size_t moduleStateHolds() {
  ModuleState& s = state();
  std::lock_guard<std::mutex> g(s.m);
  return s.holds;
}

ModuleStateHold::ModuleStateHold() {
  ModuleState& s = state();
  std::lock_guard<std::mutex> g(s.m);
  s.holds++;
}

ModuleStateHold::~ModuleStateHold() {
  ModuleState& s = state();
  std::lock_guard<std::mutex> g(s.m);
  s.holds--;
}

// --- native calls ---------------------------------------------------------------

std::shared_ptr<NativeCall> NativeCall::start() {
  std::shared_ptr<NativeCall> call(new NativeCall(newRuntimeId()));
  attachRuntime(call->id_, call);
  return call;
}

NativeCall::NativeCall(RuntimeId id) : id_(id), hold_(std::make_unique<ModuleStateHold>()) {}

NativeCall::~NativeCall() { end(); }

std::shared_ptr<Scope> NativeCall::scopeFor(ExecutionContext& actor) {
  std::shared_ptr<Scope> made;
  {
    std::lock_guard<std::mutex> g(mutex_);
    auto it = scopes_.find(&actor);
    if (it != scopes_.end()) return it->second;

    made = Scope::create(id_, actor.root());
    scopes_.emplace(&actor, made);
  }

  // Ended already: nothing more starts for it.
  if (!live_.load()) made->dispose();
  return made;
}

void NativeCall::end() {
  if (!live_.exchange(false)) return;

  std::vector<std::shared_ptr<Scope>> scopes;
  {
    std::lock_guard<std::mutex> g(mutex_);
    for (auto& [actor, scope] : scopes_) scopes.push_back(scope);
  }
  for (auto& scope : scopes)
    if (auto e = scope->dispose()) reportUncaught(e, "native call");

  detachRuntime(id_);
  hold_.reset();
}

}  // namespace lucent
