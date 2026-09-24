// Lucent runtime — the JavaScript side of the boundary.
//
// A Host is created per JS runtime (the React Native TurboModule creates it;
// tests create it directly). It owns every JSI object Lucent keeps alive:
// pending promise resolvers, JS callbacks, class prototypes and the identity
// cache. JSI values may only be touched on the JS thread, so native code
// refers to them by id and hops to the JS thread to use them.
#pragma once

#include <jsi/jsi.h>

#include <atomic>
#include <functional>
#include <memory>
#include <mutex>
#include <string>
#include <thread>
#include <unordered_map>
#include <vector>

#include "../lucent.h"

namespace lucent::js {

namespace jsi = facebook::jsi;

using JsTask = std::function<void(jsi::Runtime&)>;
/// Schedules a task on the JS thread (CallInvoker::invokeAsync in React Native).
using JsPoster = std::function<void(JsTask)>;

class Host;

/// A property name generated code reads or writes on JavaScript objects
/// (a struct's fields): its jsi::PropNameID is made once per runtime and kept
/// by the Host, instead of interning the name on every access.
struct PropName {
  const char* text;
  size_t id;
  explicit PropName(const char* t) : text(t), id(next()) {}

 private:
  static size_t next() {
    static std::atomic<size_t> count{0};
    return count++;
  }
};

/// One Lucent module as seen from JavaScript: fills `exports` with the
/// module's functions, classes and constants.
struct ModuleDef {
  const char* name;
  void (*install)(jsi::Runtime& rt, Host& host, jsi::Object& exports);
};

/// Implemented by generated code: the modules of this app.
const ModuleDef* registeredModules(size_t& count);
/// Implemented by generated code: resets module-level state for a new runtime.
void resetModuleState();

class Host : public std::enable_shared_from_this<Host> {
 public:
  /// Creates the host for `rt`. Call on the JS thread.
  static std::shared_ptr<Host> create(jsi::Runtime& rt, JsPoster poster);
  static Host& get(jsi::Runtime& rt);
  /// The host for a call to a function `installed` defined: that host while
  /// it lives, without get()'s lookup (a thread_local, which Android builds
  /// for minSdk < 29 emulate with pthread_getspecific), else get()'s.
  static Host& from(jsi::Runtime& rt, const std::shared_ptr<Host>& installed) {
    return installed->alive() ? *installed : get(rt);
  }
  ~Host();

  jsi::Runtime& runtime() { return rt_; }
  bool onJsThread() const { return std::this_thread::get_id() == jsThread_; }
  bool alive() const { return alive_.load(); }

  /// Runs `task` on the JS thread unless the host was invalidated.
  void postToJs(JsTask task);
  /// Drops every JSI reference. Call on the JS thread before the runtime dies.
  void invalidate();

  /// The exports object of a module, created on first use.
  jsi::Value module(jsi::Runtime& rt, const std::string& name);
  /// The object with every module as a property (for tests and debugging).
  jsi::Object modules(jsi::Runtime& rt);

  // --- promises ---------------------------------------------------------
  /// Creates a JS promise; settle it later with resolve/reject on the JS thread.
  jsi::Value createPromise(jsi::Runtime& rt, uint64_t& id);
  void resolve(jsi::Runtime& rt, uint64_t id, const jsi::Value& value);
  void reject(jsi::Runtime& rt, uint64_t id, const jsi::Value& error);

  // --- callbacks ----------------------------------------------------------
  uint64_t retain(jsi::Runtime& rt, jsi::Function fn);
  jsi::Function* retained(uint64_t id);
  /// Safe from any thread: releases on the JS thread.
  void release(uint64_t id);

  // --- classes --------------------------------------------------------------
  using PrototypeInit = void (*)(jsi::Runtime& rt, Host& host, jsi::Object& proto);
  /// The prototype for class `key`: the runtime's own across hosts (kept on
  /// the global object), with this host's methods.
  jsi::Object& prototype(jsi::Runtime& rt, const char* key, PrototypeInit init);
  /// The JS object for a native instance: the same object each time while
  /// JavaScript still references it.
  jsi::Value wrap(jsi::Runtime& rt, const Ref<Object>& instance, const char* key, PrototypeInit init);

  /// Converts a Lucent error into a JS Error object (not thrown).
  jsi::Value errorToJs(jsi::Runtime& rt, const Error& e);
  /// Converts a caught JS exception into a Lucent error.
  static Error errorFromJs(jsi::Runtime& rt, const jsi::JSError& e);

  /// The runtime's id for a property name, made on first use.
  const jsi::PropNameID& prop(jsi::Runtime& rt, const PropName& name) {
    if (name.id < props_.size() && props_[name.id]) return *props_[name.id];
    return makeProp(rt, name);
  }

 private:
  Host(jsi::Runtime& rt, JsPoster poster);

  struct Resolvers {
    jsi::Function resolve;
    jsi::Function reject;
  };

  jsi::Runtime& rt_;
  JsPoster poster_;
  std::thread::id jsThread_;
  std::atomic<bool> alive_{true};
  uint64_t nextId_ = 1;
  std::unordered_map<uint64_t, Resolvers> promises_;
  std::unordered_map<uint64_t, jsi::Function> functions_;
  std::unordered_map<std::string, jsi::Object> prototypes_;
  std::unordered_map<std::string, jsi::Value> modules_;
  std::unordered_map<uint64_t, jsi::WeakObject> identities_;
  size_t identitySweep_ = 0;
  std::vector<std::unique_ptr<jsi::PropNameID>> props_;
  const jsi::PropNameID& makeProp(jsi::Runtime& rt, const PropName& name);
};

/// Holds a strong reference to the Host while posting results back to JS.
using HostRef = std::shared_ptr<Host>;

/// NativeState attached to the JS object of a Lucent class instance.
struct InstanceState : jsi::NativeState {
  explicit InstanceState(Ref<Object> o) : object(std::move(o)) {}
  Ref<Object> object;
};
using InstanceStateBase = InstanceState;

/// The native instance behind a JS object, or null.
Ref<Object> instanceOf(jsi::Runtime& rt, const jsi::Value& v);

using HostFn = jsi::HostFunctionType;

void defineFunction(jsi::Runtime& rt, jsi::Object& target, const char* name, unsigned argc, HostFn fn);
/// Defines an enumerable accessor property; `setter` may be null.
void defineAccessor(jsi::Runtime& rt, jsi::Object& target, const char* name, HostFn getter, HostFn setter);
/// Exports a class: `name` is a factory function whose `prototype` is the
/// class prototype. The JS proxy wraps it in a real constructor so `new` and
/// `instanceof` work.
void defineClass(jsi::Runtime& rt, Host& host, jsi::Object& exports, const char* name, const char* key, Host::PrototypeInit init,
                 unsigned argc, HostFn construct);

}  // namespace lucent::js
