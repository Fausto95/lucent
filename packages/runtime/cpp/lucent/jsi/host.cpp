#include "host.h"

#include <cstring>
#include <string>
#include <vector>

#include "../execution.h"
#include "../view.h"
#include "convert.h"

namespace lucent::js {

namespace {

std::mutex& registryMutex() {
  static std::mutex m;
  return m;
}
std::unordered_map<jsi::Runtime*, std::weak_ptr<Host>>& registry() {
  static auto* r = new std::unordered_map<jsi::Runtime*, std::weak_ptr<Host>>();
  return *r;
}

// Changes whenever the registry does, so a thread's cached host is known
// stale. Constant-initialized: reading it needs no guard.
std::atomic<uint64_t> registryGeneration{1};

// Constant-initialized: safe to use during static initialization.
std::atomic<RuntimeId> nextRuntimeId{1};

// The last host this thread looked up: every call from JavaScript asks for
// it, and a thread nearly always talks to one runtime. One thread_local, as
// each costs a lookup on some platforms (__tlv_get_addr on Apple's).
struct CachedHost {
  jsi::Runtime* runtime = nullptr;
  Host* host = nullptr;
  uint64_t generation = 0;
};
thread_local CachedHost cached;

/// Runs `job` on `actor`: here if this thread is in it, else as a turn
/// there. Either way `job` is destroyed there, holding its lock, like the
/// values it carries.
void onActor(Actor& actor, Job job) {
  if (!actor.isCurrent()) {
    actor.post(std::move(job));
    return;
  }

  detail::runGuarded(job, "job");
}

/// Counts one task or job in flight for a host while it lives.
class Counted {
 public:
  explicit Counted(std::shared_ptr<std::atomic<size_t>> count) : count_(std::move(count)) { ++*count_; }

  ~Counted() { --*count_; }

  Counted(const Counted&) = delete;
  Counted& operator=(const Counted&) = delete;

 private:
  std::shared_ptr<std::atomic<size_t>> count_;
};

/// A task for the JS thread. If it never runs there, it is released on the
/// actor that posted it, after `dropped`: the values it carries are that
/// actor's, whichever thread gave up on the task. It counts as in flight
/// until then.
struct Parcel {
  std::shared_ptr<Counted> counted;
  JsTask task;
  Job dropped;
  Actor& actor = currentActor();
  std::atomic<bool> ran{false};

  Parcel(std::shared_ptr<Counted> c, JsTask t, Job d) : counted(std::move(c)), task(std::move(t)), dropped(std::move(d)) {}

  ~Parcel() {
    if (ran.load()) return;

    onActor(actor, [counted = std::move(counted), task = std::move(task), dropped = std::move(dropped)]() mutable {
      if (dropped) dropped();

      task = nullptr;
      dropped = nullptr;
    });
  }
};

}  // namespace

// Installed on the JS global object so the runtime's teardown releases our
// JSI references on the JS thread while the runtime still exists. It runs
// no JavaScript: the runtime may be being destroyed.
class Host::Anchor : public jsi::HostObject {
 public:
  explicit Anchor(std::shared_ptr<Host> host) : host_(std::move(host)) {}

  ~Anchor() override { host_->tearDown(false); }

#ifndef NDEBUG
  jsi::Value get(jsi::Runtime& rt, const jsi::PropNameID& name) override {
    if (name.utf8(rt) != "ownership") return jsi::Value::undefined();

    return ownershipObject(rt, host_->ownership());
  }

  /// What the host holds for JavaScript, as an object.
  static jsi::Object ownershipObject(jsi::Runtime& rt, const Ownership& held) {
    jsi::Object o(rt);
    o.setProperty(rt, "runtime", static_cast<double>(held.runtime));
    o.setProperty(rt, "promises", static_cast<double>(held.promises));
    o.setProperty(rt, "callbacks", static_cast<double>(held.callbacks));
    o.setProperty(rt, "identities", static_cast<double>(held.identities));
    o.setProperty(rt, "prototypes", static_cast<double>(held.prototypes));
    o.setProperty(rt, "modules", static_cast<double>(held.modules));
    o.setProperty(rt, "registrations", static_cast<double>(held.registrations));
    o.setProperty(rt, "inFlight", static_cast<double>(held.inFlight));
    return o;
  }

  /**
   * __lucentDebug: snapshot(), a promise of what the runtime owns live, its
   * live mounts with their views' trees (built on the main context, view.h
   * debugSnapshot), and what this host holds for JavaScript; settled on the
   * JS thread. Debug builds only.
   */
  static jsi::Object debugObject(jsi::Runtime& rt, const std::shared_ptr<Host>& host) {
    std::weak_ptr<Host> weak = host;
    jsi::Object debug(rt);

    debug.setProperty(
        rt, "snapshot",
        jsi::Function::createFromHostFunction(
            rt, jsi::PropNameID::forAscii(rt, "snapshot"), 0,
            [weak](jsi::Runtime& rt, const jsi::Value&, const jsi::Value*, size_t) -> jsi::Value {
              auto host = weak.lock();
              if (!host) return jsi::Value::undefined();

              uint64_t id = 0;
              jsi::Value promise = host->createPromise(rt, id);

              ExecutionContext::main().post([weak, id] {
                const std::string json = ui::debugSnapshot();

                if (auto host = weak.lock())
                  host->postToJs([weak, id, json](jsi::Runtime& rt) {
                    auto host = weak.lock();
                    if (!host) return;

                    jsi::Value parsed = rt.global()
                                            .getPropertyAsObject(rt, "JSON")
                                            .getPropertyAsFunction(rt, "parse")
                                            .call(rt, jsi::String::createFromUtf8(rt, json));
                    jsi::Object snapshot = parsed.getObject(rt);
                    snapshot.setProperty(rt, "host", ownershipObject(rt, host->ownership()));
                    host->resolve(rt, id, jsi::Value(rt, snapshot));
                  });
              });

              return promise;
            }));

    return debug;
  }
#endif

 private:
  std::shared_ptr<Host> host_;
};

std::shared_ptr<Host> Host::create(jsi::Runtime& rt, JsPoster poster) {
  std::shared_ptr<Host> previous;
  {
    std::lock_guard<std::mutex> g(registryMutex());
    auto it = registry().find(&rt);
    if (it != registry().end()) previous = it->second.lock();
  }

  if (previous) previous->invalidate();

  std::shared_ptr<Host> host(new Host(rt, std::move(poster)));
  {
    std::lock_guard<std::mutex> g(registryMutex());
    registry()[&rt] = host;
    registryGeneration++;
  }
  rt.global().setProperty(rt, "__lucentHost", jsi::Object::createFromHostObject(rt, std::make_shared<Anchor>(host)));
#ifndef NDEBUG
  rt.global().setProperty(rt, "__lucentDebug", Anchor::debugObject(rt, host));
#endif

  // Module code's work for this runtime belongs to it: tearing it down
  // cancels that work, and only that.
  attachRuntime(host->id(), host);

  // Module state is the process's: a second runtime alongside a first
  // shares it. Each module's initialization holds its actor.
  if (!otherRuntimes(host->id())) {
    RuntimeEntry entry(host->id());
    resetModuleState();
  }
  return host;
}

Host& Host::get(jsi::Runtime& rt) {
  uint64_t generation = registryGeneration.load(std::memory_order_acquire);
  CachedHost& c = cached;
  if (c.runtime == &rt && c.generation == generation) return *c.host;
  std::lock_guard<std::mutex> g(registryMutex());
  auto it = registry().find(&rt);
  if (it != registry().end()) {
    if (auto h = it->second.lock()) {
      c = {&rt, h.get(), registryGeneration.load(std::memory_order_relaxed)};
      return *h;
    }
  }
  throw jsi::JSError(rt, "Lucent is not initialized for this runtime");
}

const jsi::PropNameID& Host::makeProp(jsi::Runtime& rt, const PropName& name) {
  if (name.id >= props_.size()) props_.resize(name.id + 1);
  props_[name.id] = std::make_unique<jsi::PropNameID>(jsi::PropNameID::forUtf8(rt, name.text));
  return *props_[name.id];
}

Host::Host(jsi::Runtime& rt, JsPoster poster)
    : id_(nextRuntimeId.fetch_add(1, std::memory_order_relaxed)),
      rt_(rt),
      poster_(std::move(poster)),
      jsThread_(std::this_thread::get_id()),
      scope_(Scope::create(id_, Actor::shared().root())) {
  scopes_.emplace(&Actor::shared(), scope_);
}

std::shared_ptr<Scope> Host::scopeFor(ExecutionContext& actor) {
  std::shared_ptr<Scope> made;
  {
    std::lock_guard<std::mutex> g(scopesMutex_);
    auto it = scopes_.find(&actor);
    if (it != scopes_.end()) return it->second;

    made = Scope::create(id_, actor.root());
    scopes_.emplace(&actor, made);
  }

  // Torn down already: nothing more starts for this runtime.
  if (!alive_.load()) made->dispose();
  return made;
}

Host::~Host() {
  detachRuntime(id_);

  std::lock_guard<std::mutex> g(registryMutex());
  auto it = registry().find(&rt_);
  if (it != registry().end() && it->second.expired()) registry().erase(it);
  registryGeneration++;
}

bool Host::postToJs(JsTask task, Job dropped) {
  auto parcel = std::make_shared<Parcel>(std::make_shared<Counted>(inFlight_), std::move(task), std::move(dropped));

  if (!alive_.load()) return false;

  std::weak_ptr<Host> weak = weak_from_this();
  poster_([weak, parcel](jsi::Runtime& rt) {
    auto self = weak.lock();
    if (!self || !self->alive()) return;

    parcel->ran = true;

    // The poster's caller (React Native's JS thread loop) is not Lucent's:
    // nothing a task throws may reach it.
    try {
      parcel->task(rt);
    } catch (...) {
      reportUncaught(std::current_exception(), "js task");
    }
  });

  return true;
}

void Host::postToModule(Actor& actor, Job job) {
  std::weak_ptr<Host> weak = weak_from_this();

  // The scope drops the job once disposed; until its disposal has run on
  // the actor, the host's own state says it is torn down.
  actor.post(
      [weak, counted = std::make_shared<Counted>(inFlight_), job = std::move(job)]() mutable {
        auto self = weak.lock();
        if (self && self->alive()) job();

        job = nullptr;
      },
      scopeFor(actor));
}

Host::Ownership Host::ownership() const {
  size_t identities = 0;
  for (auto& [native, weak] : identities_) {
    if (weak.lock(rt_).isObject()) identities++;
  }

  size_t registrations = 0;
  {
    std::lock_guard<std::mutex> g(scopesMutex_);
    for (auto& [actor, scope] : scopes_) registrations += scope->registrations();
  }

  return {id_,
          promises_.size(),
          functions_.size(),
          identities,
          prototypes_.size(),
          modules_.size(),
          registrations,
          inFlight_->load()};
}

Error Host::goneError() { return makeError(String::fromLatin1("AbortError"), String::fromLatin1("The JavaScript runtime is gone")); }

void Host::invalidate() { tearDown(true); }

void Host::tearDown(bool runtimeUsable) {
  if (!alive_.exchange(false)) return;

  // JavaScript still waiting for Lucent learns that it never will.
  auto owed = std::move(promises_);
  promises_.clear();

  if (runtimeUsable && !owed.empty()) {
    Error torn = makeError(String::fromLatin1("AbortError"), String::fromLatin1("Lucent was torn down for this JavaScript runtime"));

    for (auto& [id, resolvers] : owed) {
      try {
        resolvers.reject.call(rt_, errorToJs(rt_, torn));
      } catch (...) {
        reportUncaught(std::current_exception(), "host");
      }
    }
  }

  owed.clear();

  // Module code's destroy hooks for this runtime's state, each in its
  // actor, before the next initialization (Host::create tears the old host
  // down first); then each scope cancels its operations and runs its
  // cleanups.
  std::vector<std::pair<const ExecutionContext*, std::shared_ptr<Scope>>> scopes;
  {
    std::lock_guard<std::mutex> g(scopesMutex_);
    for (auto& [context, scope] : scopes_) scopes.emplace_back(context, scope);
  }
  for (auto& [context, scope] : scopes) {
    if (auto* actor = dynamic_cast<const Actor*>(context)) {
      LucentScope lock(const_cast<Actor&>(*actor));
      runDestroyHooks(scope.get());
    } else {
      runDestroyHooks(scope.get());
    }
  }
  for (auto& [context, scope] : scopes)
    if (auto e = scope->dispose()) reportUncaught(e, "host");

  functions_.clear();
  promiseConstructor_.reset();
  prototypes_.clear();
  modules_.clear();
  exported_.clear();
  identities_.clear();
  props_.clear();

  // Only its own entry: the runtime may have a newer host by now.
  std::weak_ptr<Host> self = weak_from_this();
  std::lock_guard<std::mutex> g(registryMutex());
  auto it = registry().find(&rt_);
  if (it != registry().end() && !it->second.owner_before(self) && !self.owner_before(it->second)) registry().erase(it);
  registryGeneration++;
}

jsi::Value Host::module(jsi::Runtime& rt, const std::string& name) {
  // A replaced host's module (a TurboModule that kept it) is the new one's.
  if (!alive()) return get(rt).module(rt, name);

  if (name == kIdentityName) return identity(rt);

  auto it = modules_.find(name);
  if (it != modules_.end()) return jsi::Value(rt, it->second);
  size_t count = 0;
  const ModuleDef* defs = registeredModules(count);
  for (size_t i = 0; i < count; i++) {
    if (name == defs[i].name) {
      jsi::Object exports(rt);
      {
        RuntimeEntry entry(id_);
        LucentScope scope(defs[i].actor ? defs[i].actor() : Actor::shared());
        defs[i].install(rt, *this, exports);
      }
      jsi::Value v(rt, exports);
      modules_.emplace(name, jsi::Value(rt, v));
      return v;
    }
  }
  return jsi::Value::undefined();
}

jsi::Object Host::modules(jsi::Runtime& rt) {
  jsi::Object all(rt);
  size_t count = 0;
  const ModuleDef* defs = registeredModules(count);
  for (size_t i = 0; i < count; i++) all.setProperty(rt, defs[i].name, module(rt, defs[i].name));
  all.setProperty(rt, kIdentityName, identity(rt));
  return all;
}

jsi::Object Host::identity(jsi::Runtime& rt) {
  const BuildIdentity& built = buildIdentity();

  jsi::Object modules(rt);
  for (size_t i = 0; i < built.moduleCount; i++)
    modules.setProperty(rt, built.modules[i].name, jsi::String::createFromUtf8(rt, built.modules[i].api));

  jsi::Object o(rt);
  o.setProperty(rt, "host", static_cast<double>(id_));
  o.setProperty(rt, "runtimeAbi", kRuntimeAbi);
  o.setProperty(rt, "target", jsi::String::createFromUtf8(rt, built.target));
  o.setProperty(rt, "program", jsi::String::createFromUtf8(rt, built.program));
  o.setProperty(rt, "modules", modules);

  return o;
}

jsi::Value Host::createPromise(jsi::Runtime& rt, uint64_t& id) {
  id = nextId_++;
  auto slot = std::make_shared<std::pair<std::optional<jsi::Function>, std::optional<jsi::Function>>>();
  auto executor = jsi::Function::createFromHostFunction(
      rt, jsi::PropNameID::forAscii(rt, "executor"), 2,
      [slot](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        slot->first.emplace(args[0].getObject(rt).getFunction(rt));
        slot->second.emplace(args[1].getObject(rt).getFunction(rt));
        return jsi::Value::undefined();
      });
  if (!promiseConstructor_) promiseConstructor_.emplace(rt.global().getPropertyAsFunction(rt, "Promise"));
  jsi::Value promise = promiseConstructor_->callAsConstructor(rt, executor);
  promises_.emplace(id, Resolvers{std::move(*slot->first), std::move(*slot->second)});
  slot->first.reset();
  slot->second.reset();
  return promise;
}

void Host::resolve(jsi::Runtime& rt, uint64_t id, const jsi::Value& value) {
  auto it = promises_.find(id);
  if (it == promises_.end()) return;
  Resolvers r = std::move(it->second);
  promises_.erase(it);
  r.resolve.call(rt, value);
}

void Host::reject(jsi::Runtime& rt, uint64_t id, const jsi::Value& error) {
  auto it = promises_.find(id);
  if (it == promises_.end()) return;
  Resolvers r = std::move(it->second);
  promises_.erase(it);
  r.reject.call(rt, error);
}

uint64_t Host::retain(jsi::Runtime&, jsi::Function fn) {
  uint64_t id = nextId_++;
  functions_.emplace(id, std::move(fn));
  return id;
}

jsi::Function* Host::retained(uint64_t id) {
  auto it = functions_.find(id);
  return it == functions_.end() ? nullptr : &it->second;
}

void Host::release(uint64_t id) {
  if (onJsThread()) {
    functions_.erase(id);
    return;
  }
  std::weak_ptr<Host> weak = weak_from_this();
  postToJs([weak, id](jsi::Runtime&) {
    if (auto self = weak.lock()) self->functions_.erase(id);
  });
}

jsi::Object& Host::prototype(jsi::Runtime& rt, const char* key, PrototypeInit init) {
  auto it = prototypes_.find(key);
  if (it != prototypes_.end()) return it->second;
  // A class keeps one prototype per runtime, not per host: JavaScript may
  // hold a replaced host's exports, and instanceof compares their prototypes
  // with the ones this host gives new instances. A kept prototype gets this
  // host's methods, so they call it directly.
  jsi::Object global = rt.global();
  jsi::Value storeValue = global.getProperty(rt, "__lucentPrototypes");
  jsi::Object store = storeValue.isObject() ? storeValue.getObject(rt) : jsi::Object(rt);
  if (!storeValue.isObject()) global.setProperty(rt, "__lucentPrototypes", store);
  jsi::Value kept = store.getProperty(rt, key);
  jsi::Object proto = kept.isObject() ? kept.getObject(rt) : jsi::Object(rt);
  init(rt, *this, proto);
  if (!kept.isObject()) store.setProperty(rt, key, proto);
  return prototypes_.emplace(key, std::move(proto)).first->second;
}

Ref<Object> instanceOf(jsi::Runtime& rt, const jsi::Value& v) {
  if (!v.isObject()) return nullptr;
  jsi::Object o = v.getObject(rt);
  if (!o.hasNativeState(rt)) return nullptr;
  auto s = std::dynamic_pointer_cast<InstanceState>(o.getNativeState(rt));
  if (!s) return nullptr;

  // One host per runtime: a live one is this runtime's.
  if (!s->host->alive()) {
    jsi::Value error = rt.global().getPropertyAsFunction(rt, "TypeError").callAsConstructor(rt, "This Lucent object belongs to a host that was torn down");
    throw jsi::JSError(rt, std::move(error));
  }

  return s->object;
}

void defineFunction(jsi::Runtime& rt, jsi::Object& target, const char* name, unsigned argc, HostFn fn) {
  target.setProperty(rt, name, jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forUtf8(rt, name), argc, std::move(fn)));
}

void defineAccessor(jsi::Runtime& rt, jsi::Object& target, const char* name, HostFn getter, HostFn setter) {
  jsi::Object descriptor(rt);
  descriptor.setProperty(rt, "enumerable", true);
  descriptor.setProperty(rt, "configurable", true);
  descriptor.setProperty(rt, "get", jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forUtf8(rt, name), 0, std::move(getter)));
  if (setter) {
    descriptor.setProperty(rt, "set", jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forUtf8(rt, name), 1, std::move(setter)));
  }
  rt.global()
      .getPropertyAsObject(rt, "Object")
      .getPropertyAsFunction(rt, "defineProperty")
      .call(rt, target, jsi::String::createFromUtf8(rt, name), descriptor);
}

void defineClass(jsi::Runtime& rt, Host& host, jsi::Object& exports, const char* name, const char* key, Host::PrototypeInit init,
                 unsigned argc, HostFn construct) {
  jsi::Function factory = jsi::Function::createFromHostFunction(rt, jsi::PropNameID::forUtf8(rt, name), argc, std::move(construct));
  factory.setProperty(rt, "prototype", jsi::Value(rt, host.prototype(rt, key, init)));
  exports.setProperty(rt, name, factory);
}

jsi::Value Host::wrap(jsi::Runtime& rt, const Ref<Object>& instance, const char* key, PrototypeInit init) {
  if (!instance) return jsi::Value::null();
  auto it = identities_.find(instance.get());
  if (it != identities_.end()) {
    jsi::Value v = it->second.lock(rt);
    if (v.isObject()) return v;
  }
  jsi::Object& proto = prototype(rt, key, init);
  jsi::Object obj = jsi::Object::create(rt, jsi::Value(rt, proto));
  obj.setNativeState(rt, std::make_shared<InstanceState>(instance, shared_from_this()));
  // Periodically drop cache entries whose JS objects were collected.
  if (++identitySweep_ >= 256) {
    identitySweep_ = 0;
    std::vector<const Object*> dead;
    for (auto& [native, weak] : identities_) {
      if (!weak.lock(rt).isObject()) dead.push_back(native);
    }
    for (const Object* native : dead) identities_.erase(native);
  }
  identities_.insert_or_assign(instance.get(), jsi::WeakObject(rt, obj));
  return jsi::Value(std::move(obj));
}

namespace {

/// `head`, then the Lucent frame `site` when there is one, then the frames
/// of `stack`, a JS Error's.
std::string stackWithSite(const std::string& head, const Opt<String>& site, const std::string& stack) {
  size_t firstFrame = stack.find('\n');
  std::string frames = firstFrame == std::string::npos ? "" : stack.substr(firstFrame);
  return site.has() ? head + "\n    at " + site.get().toUtf8() + frames : head + frames;
}

/// `o[name] = value` as JavaScript assigns an Error's own data property:
/// writable, configurable, not enumerable, even over an accessor it inherits.
void defineOwn(jsi::Runtime& rt, const jsi::Object& o, const char* name, const jsi::Value& value) {
  jsi::Object descriptor(rt);
  descriptor.setProperty(rt, "value", value);
  descriptor.setProperty(rt, "writable", true);
  descriptor.setProperty(rt, "configurable", true);
  rt.global()
      .getPropertyAsObject(rt, "Object")
      .getPropertyAsFunction(rt, "defineProperty")
      .call(rt, o, jsi::String::createFromAscii(rt, name), descriptor);
}

bool hasOwn(jsi::Runtime& rt, const jsi::Object& o, const char* name) {
  return rt.global()
      .getPropertyAsObject(rt, "Object")
      .getPropertyAsObject(rt, "prototype")
      .getPropertyAsFunction(rt, "hasOwnProperty")
      .callWithThis(rt, o, jsi::String::createFromAscii(rt, name))
      .getBool();
}

/// What JavaScript's `e.stack` reads when the error has no stack of its own.
String errorStack(const Error& e) {
  if (e->stack.has()) return e->stack.get();
  String head = errorToString(e);
  return e->site.has() ? head + String::fromLatin1("\n    at ") + e->site.get() : head;
}

/// An accessor of the native error behind `thisVal`; on anything else
/// (the prototype itself), Error.prototype's property, as JavaScript's
/// subclasses inherit it.
void defineErrorAccessor(jsi::Runtime& rt, Host& host, jsi::Object& proto, const char* name, String (*read)(const Error&),
                         void (*write)(const Error&, String)) {
  auto self = [](jsi::Runtime& rt, const jsi::Value& thisVal) { return std::dynamic_pointer_cast<ErrorObject>(instanceOf(rt, thisVal)); };
  auto getter = [installed = host.shared_from_this(), name, read, self](jsi::Runtime& rt, const jsi::Value& thisVal, const jsi::Value*,
                                                                       size_t) -> jsi::Value {
    Error e = self(rt, thisVal);
    if (!e) return rt.global().getPropertyAsObject(rt, "Error").getPropertyAsObject(rt, "prototype").getProperty(rt, name);
    return callSync(rt, Host::from(rt, installed), [&]() -> jsi::Value { return jsi::Value(stringToJs(rt, read(e))); });
  };
  auto setter = [installed = host.shared_from_this(), name, write, self](jsi::Runtime& rt, const jsi::Value& thisVal, const jsi::Value* args,
                                                                        size_t count) -> jsi::Value {
    Error e = write ? self(rt, thisVal) : nullptr;
    if (!e) {
      if (thisVal.isObject()) defineOwn(rt, thisVal.getObject(rt), name, arg(args, count, 0));
      return jsi::Value::undefined();
    }
    std::string fn = std::string("Error.") + name;
    String value = Convert<String>::fromJs(rt, arg(args, count, 0), Path{fn.c_str(), "value"});
    return callSync(rt, Host::from(rt, installed), [&]() -> jsi::Value {
      write(e, std::move(value));
      return jsi::Value::undefined();
    });
  };
  defineAccessor(rt, proto, name, getter, setter);
}

}  // namespace

void defineErrorPrototype(jsi::Runtime& rt, Host& host, jsi::Object& proto) {
  jsi::Object object = rt.global().getPropertyAsObject(rt, "Object");
  jsi::Value errorProto = rt.global().getPropertyAsObject(rt, "Error").getProperty(rt, "prototype");
  object.getPropertyAsFunction(rt, "setPrototypeOf").call(rt, proto, errorProto);

  defineErrorAccessor(
      rt, host, proto, "name", [](const Error& e) { return e->name; }, [](const Error& e, String v) { e->name = std::move(v); });
  defineErrorAccessor(
      rt, host, proto, "message", [](const Error& e) { return e->message; },
      [](const Error& e, String v) { e->message = std::move(v); });
  // Assigning `stack` gives the object its own, as on an Error.
  defineErrorAccessor(rt, host, proto, "stack", errorStack, nullptr);

  // Not enumerable, as an Error's own are.
  for (const char* name : {"name", "message", "stack"}) {
    jsi::Object descriptor(rt);
    descriptor.setProperty(rt, "enumerable", false);
    object.getPropertyAsFunction(rt, "defineProperty").call(rt, proto, jsi::String::createFromAscii(rt, name), descriptor);
  }
}

jsi::Value Host::errorToJs(jsi::Runtime& rt, const Error& e) {
  jsi::Value instance = errorInstanceToJs(rt, *this, e);
  if (instance.isObject()) {
    // Its stack, once: the Lucent frame that made it, if any, then the
    // JavaScript frames where it first reached JavaScript.
    jsi::Object o = instance.getObject(rt);
    if (!e->stack.has() && !hasOwn(rt, o, "stack")) {
      jsi::Value here = rt.global().getPropertyAsFunction(rt, "Error").callAsConstructor(rt).getObject(rt).getProperty(rt, "stack");
      std::string frames = here.isString() ? here.getString(rt).utf8(rt) : "";
      defineOwn(rt, o, "stack", jsi::String::createFromUtf8(rt, stackWithSite(errorToString(e).toUtf8(), e->site, frames)));
    }
    return instance;
  }

  std::string name = e->name.toUtf8();
  // The kinds Lucent throws (SyntaxError from BigInt(string)), as JavaScript's own.
  const char* ctor = (name == "TypeError" || name == "RangeError" || name == "SyntaxError") ? name.c_str() : "Error";
  jsi::Object err = rt.global()
                        .getPropertyAsFunction(rt, ctor)
                        .callAsConstructor(rt, jsi::String::createFromUtf8(rt, e->message.toUtf8()))
                        .getObject(rt);
  if (name != ctor) err.setProperty(rt, "name", jsi::String::createFromUtf8(rt, name));
  if (e->code.has()) err.setProperty(rt, "code", jsi::String::createFromUtf8(rt, e->code.get().toUtf8()));
  if (e->stack.has()) {
    // An error that came from JavaScript keeps its original stack.
    err.setProperty(rt, "stack", jsi::String::createFromUtf8(rt, e->stack.get().toUtf8()));
  } else if (e->site.has()) {
    // The Lucent frame where the error was created, above the JavaScript frames.
    jsi::Value current = err.getProperty(rt, "stack");
    std::string stack = current.isString() ? current.getString(rt).utf8(rt) : "";
    size_t firstFrame = stack.find('\n');
    std::string head = firstFrame == std::string::npos ? stack : stack.substr(0, firstFrame);
    err.setProperty(rt, "stack", jsi::String::createFromUtf8(rt, stackWithSite(head, e->site, stack)));
  }
  return jsi::Value(std::move(err));
}

Error Host::errorFromJs(jsi::Runtime& rt, const jsi::JSError& e) {
  // A Lucent error that went through JavaScript is itself again.
  if (auto own = std::dynamic_pointer_cast<ErrorObject>(instanceOf(rt, e.value()))) return own;
  Error out = makeError(String::fromLatin1("Error"), String::fromUtf8(e.getMessage()));
  out->stack = String::fromUtf8(e.getStack());
  const jsi::Value& v = e.value();
  if (v.isObject()) {
    jsi::Object o = v.getObject(rt);
    jsi::Value name = o.getProperty(rt, "name");
    if (name.isString()) out->name = String::fromUtf8(name.getString(rt).utf8(rt));
    jsi::Value code = o.getProperty(rt, "code");
    if (code.isString()) out->code = String::fromUtf8(code.getString(rt).utf8(rt));
    jsi::Value message = o.getProperty(rt, "message");
    if (message.isString()) out->message = String::fromUtf8(message.getString(rt).utf8(rt));
  }
  return out;
}

}  // namespace lucent::js
