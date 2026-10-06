// Lucent runtime — the JavaScript side of the boundary.
//
// A Host is created per JS runtime (the React Native TurboModule creates it;
// tests create it directly). It owns every JSI object Lucent keeps alive:
// pending promise resolvers, JS callbacks, class prototypes and the identity
// cache. JSI values may only be touched on the JS thread, so native code
// refers to them by id and hops to the JS thread to use them.
//
// Work for a runtime belongs to its host's scope, and ends with the host:
// torn down (a reload, the runtime's end), the host disposes its scope,
// drops what it posted that has not run, and releases what that carried on
// the legacy module context.
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
/// Implemented by generated code: the JS object of `e` when it is an
/// instance of a Lucent class that extends Error (its class's prototype,
/// its identity), else undefined.
jsi::Value errorInstanceToJs(jsi::Runtime& rt, Host& host, const Error& e);

/// What generated code and JavaScript proxies expect of this runtime: a
/// change that breaks either takes a new number. The compiler's
/// RUNTIME_ABI; generated code checks it as it builds.
inline constexpr int kRuntimeAbi = 2;

/// A module as the program was compiled: its name, and a hash of what
/// JavaScript sees of it (its exports and their signatures).
struct ModuleIdentity {
  const char* name;
  const char* api;
};

/// What this app's native code was built from, which JavaScript checks its
/// proxies against before they call it: the target it was compiled for
/// ("all" for code every target shares), a hash of the program, and each
/// module's API.
struct BuildIdentity {
  const char* target;
  const char* program;
  const ModuleIdentity* modules;
  size_t moduleCount;
};

/// Implemented by generated code.
const BuildIdentity& buildIdentity();

/// The name JavaScript reads the build identity by, next to the modules.
inline constexpr const char* kIdentityName = "__lucentIdentity";

class Host : public std::enable_shared_from_this<Host> {
 public:
  /// Creates the host for `rt`. Call on the JS thread. A runtime has one
  /// host: one it had already is torn down (invalidate) and replaced.
  static std::shared_ptr<Host> create(jsi::Runtime& rt, JsPoster poster);
  static Host& get(jsi::Runtime& rt);
  /// The host for a call to a function `installed` defined: that host while
  /// it lives, without get()'s lookup (a thread_local, which Android builds
  /// for minSdk < 29 emulate with pthread_getspecific), else get()'s.
  static Host& from(jsi::Runtime& rt, const std::shared_ptr<Host>& installed) {
    return installed->alive() ? *installed : get(rt);
  }
  ~Host();

  /// Nonzero, and no other host has had it: what scopes and tokens of
  /// work for this runtime carry.
  RuntimeId id() const { return id_; }

  jsi::Runtime& runtime() { return rt_; }
  bool onJsThread() const { return std::this_thread::get_id() == jsThread_; }
  bool alive() const { return alive_.load(); }

  /// The root of the work done for this runtime, under the legacy module
  /// context's root scope: disposed there when the host is torn down,
  /// cancelling its operations and running its cleanups.
  const std::shared_ptr<Scope>& scope() const { return scope_; }

  /// Runs `task` on the JS thread unless the host is torn down first. A
  /// task that never runs (the host torn down, or the poster dropped it)
  /// is released on the legacy module context, after `dropped` runs there.
  /// False if the host was already torn down.
  bool postToJs(JsTask task, Job dropped = nullptr);

  /// Runs `job` as a turn of the legacy module context unless the host is
  /// torn down before it starts; dropped, it is released there.
  void postToModule(Job job);

  /// Tears the host down, on the JS thread while its runtime is usable:
  /// the JS promises it owes reject with an AbortError, then its scope is
  /// disposed and every JSI reference dropped. Idempotent.
  void invalidate();

  /// What Lucent code waiting on this runtime gets once the host is torn
  /// down: an AbortError.
  static Error goneError();

  /// What the host holds, for debug ownership reports and tests (debug
  /// builds show it to JavaScript as `__lucentHost.ownership`).
  struct Ownership {
    RuntimeId runtime = 0;
    /// JS promises it will settle.
    size_t promises = 0;
    /// JS functions Lucent holds.
    size_t callbacks = 0;
    /// Live JS objects of native instances.
    size_t identities = 0;
    size_t prototypes = 0;
    size_t modules = 0;
    /// What its scope holds: JS promises Lucent awaits, operations, …
    size_t registrations = 0;
    size_t inFlight = 0;
  };

  /// On the JS thread.
  Ownership ownership() const;

  /// Tasks for the JS thread and jobs for the module context posted for
  /// this runtime that have not yet run or been released. Any thread.
  size_t inFlight() const { return inFlight_->load(); }

  /// The exports object of a module, created on first use; for
  /// kIdentityName, identity().
  jsi::Value module(jsi::Runtime& rt, const std::string& name);
  /// The object with every module as a property, and the identity (for
  /// test hosts, which install it as React Native's module would be).
  jsi::Object modules(jsi::Runtime& rt);

  /// The build identity for JavaScript: `{host, runtimeAbi, target,
  /// program, modules: {name: api}}`, `host` being this host's id.
  jsi::Object identity(jsi::Runtime& rt);

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
  /// The JS object for a native instance in this runtime: the same object
  /// each time while JavaScript still references it. Each runtime has its
  /// own for the same instance.
  jsi::Value wrap(jsi::Runtime& rt, const Ref<Object>& instance, const char* key, PrototypeInit init);

  /// Converts a Lucent error into a JS Error object (not thrown): an
  /// instance of a Lucent class that extends Error is its own JS object.
  jsi::Value errorToJs(jsi::Runtime& rt, const Error& e);
  /// Converts a caught JS exception into a Lucent error.
  static Error errorFromJs(jsi::Runtime& rt, const jsi::JSError& e);

  /// The runtime's id for a property name, made on first use.
  const jsi::PropNameID& prop(jsi::Runtime& rt, const PropName& name) {
    if (name.id < props_.size() && props_[name.id]) return *props_[name.id];
    return makeProp(rt, name);
  }

 private:
  /// On the global object: tears the host down when the runtime does.
  class Anchor;

  Host(jsi::Runtime& rt, JsPoster poster);

  /// invalidate(), but JS runs only if `runtimeUsable`: not while the
  /// runtime is being destroyed.
  void tearDown(bool runtimeUsable);

  struct Resolvers {
    jsi::Function resolve;
    jsi::Function reject;
  };

  const RuntimeId id_;
  jsi::Runtime& rt_;
  JsPoster poster_;
  std::thread::id jsThread_;
  std::atomic<bool> alive_{true};
  const std::shared_ptr<Scope> scope_;
  const std::shared_ptr<std::atomic<size_t>> inFlight_ = std::make_shared<std::atomic<size_t>>(0);
  uint64_t nextId_ = 1;
  std::unordered_map<uint64_t, Resolvers> promises_;
  std::unordered_map<uint64_t, jsi::Function> functions_;
  std::unordered_map<std::string, jsi::Object> prototypes_;
  std::unordered_map<std::string, jsi::Value> modules_;
  // Keyed by the native instance: its JS object keeps it alive, so while
  // an entry's object lives, no other instance can have its address.
  std::unordered_map<const Object*, jsi::WeakObject> identities_;
  size_t identitySweep_ = 0;
  std::vector<std::unique_ptr<jsi::PropNameID>> props_;
  const jsi::PropNameID& makeProp(jsi::Runtime& rt, const PropName& name);
};

/// NativeState attached to the JS object of a Lucent class instance, and
/// the host that made it.
struct InstanceState : jsi::NativeState {
  InstanceState(Ref<Object> o, std::shared_ptr<Host> h) : object(std::move(o)), host(std::move(h)) {}
  Ref<Object> object;
  std::shared_ptr<Host> host;
};

/// The native instance behind a JS object, or null. Throws a TypeError for
/// an object a torn-down host made: the state it belongs to has ended.
Ref<Object> instanceOf(jsi::Runtime& rt, const jsi::Value& v);

using HostFn = jsi::HostFunctionType;

void defineFunction(jsi::Runtime& rt, jsi::Object& target, const char* name, unsigned argc, HostFn fn);
/// Defines an enumerable accessor property; `setter` may be null.
void defineAccessor(jsi::Runtime& rt, jsi::Object& target, const char* name, HostFn getter, HostFn setter);
/// Makes `proto`, the prototype of a Lucent class that extends Error, an
/// Error's: Error.prototype is its prototype, and `name`, `message` and
/// `stack` are the native error's.
void defineErrorPrototype(jsi::Runtime& rt, Host& host, jsi::Object& proto);
/// Exports a class: `name` is a factory function whose `prototype` is the
/// class prototype. The JS proxy wraps it in a real constructor so `new` and
/// `instanceof` work.
void defineClass(jsi::Runtime& rt, Host& host, jsi::Object& exports, const char* name, const char* key, Host::PrototypeInit init,
                 unsigned argc, HostFn construct);

}  // namespace lucent::js
