#include "host.h"

#include <cstring>
#include <vector>

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

// Installed on the JS global object so the runtime's teardown releases our
// JSI references on the JS thread while the runtime still exists.
class HostAnchor : public jsi::HostObject {
 public:
  explicit HostAnchor(std::shared_ptr<Host> host) : host_(std::move(host)) {}
  ~HostAnchor() override {
    if (host_) host_->invalidate();
  }

 private:
  std::shared_ptr<Host> host_;
};

}  // namespace

std::shared_ptr<Host> Host::create(jsi::Runtime& rt, JsPoster poster) {
  std::shared_ptr<Host> host(new Host(rt, std::move(poster)));
  {
    std::lock_guard<std::mutex> g(registryMutex());
    registry()[&rt] = host;
  }
  rt.global().setProperty(rt, "__lucentHost", jsi::Object::createFromHostObject(rt, std::make_shared<HostAnchor>(host)));
  {
    LucentScope scope;
    resetModuleState();
  }
  return host;
}

Host& Host::get(jsi::Runtime& rt) {
  std::lock_guard<std::mutex> g(registryMutex());
  auto it = registry().find(&rt);
  if (it != registry().end()) {
    if (auto h = it->second.lock()) return *h;
  }
  throw jsi::JSError(rt, "Lucent is not initialized for this runtime");
}

Host::Host(jsi::Runtime& rt, JsPoster poster) : rt_(rt), poster_(std::move(poster)), jsThread_(std::this_thread::get_id()) {}

Host::~Host() {
  std::lock_guard<std::mutex> g(registryMutex());
  auto it = registry().find(&rt_);
  if (it != registry().end() && it->second.expired()) registry().erase(it);
}

void Host::postToJs(JsTask task) {
  if (!alive_.load()) return;
  std::weak_ptr<Host> weak = weak_from_this();
  poster_([weak, task = std::move(task)](jsi::Runtime& rt) {
    auto self = weak.lock();
    if (!self || !self->alive()) return;
    task(rt);
  });
}

void Host::invalidate() {
  if (!alive_.exchange(false)) return;
  promises_.clear();
  functions_.clear();
  prototypes_.clear();
  modules_.clear();
  identities_.clear();
  std::lock_guard<std::mutex> g(registryMutex());
  auto it = registry().find(&rt_);
  if (it != registry().end()) registry().erase(it);
}

jsi::Value Host::module(jsi::Runtime& rt, const std::string& name) {
  auto it = modules_.find(name);
  if (it != modules_.end()) return jsi::Value(rt, it->second);
  size_t count = 0;
  const ModuleDef* defs = registeredModules(count);
  for (size_t i = 0; i < count; i++) {
    if (name == defs[i].name) {
      jsi::Object exports(rt);
      {
        LucentScope scope;
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
  return all;
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
  jsi::Value promise = rt.global().getPropertyAsFunction(rt, "Promise").callAsConstructor(rt, executor);
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
  jsi::Object proto(rt);
  init(rt, *this, proto);
  return prototypes_.emplace(key, std::move(proto)).first->second;
}

namespace {
std::atomic<uint64_t> nextIdentity{1};
}  // namespace

Ref<Object> instanceOf(jsi::Runtime& rt, const jsi::Value& v) {
  if (!v.isObject()) return nullptr;
  jsi::Object o = v.getObject(rt);
  if (!o.hasNativeState(rt)) return nullptr;
  auto s = std::dynamic_pointer_cast<InstanceState>(o.getNativeState(rt));
  return s ? s->object : nullptr;
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
  if (instance->jsIdentity != 0) {
    auto it = identities_.find(instance->jsIdentity);
    if (it != identities_.end()) {
      jsi::Value v = it->second.lock(rt);
      if (v.isObject()) return v;
    }
  } else {
    instance->jsIdentity = nextIdentity.fetch_add(1);
  }
  jsi::Object& proto = prototype(rt, key, init);
  jsi::Object obj = jsi::Object::create(rt, jsi::Value(rt, proto));
  obj.setNativeState(rt, std::make_shared<InstanceState>(instance));
  // Periodically drop cache entries whose JS objects were collected.
  if (++identitySweep_ >= 256) {
    identitySweep_ = 0;
    std::vector<uint64_t> dead;
    for (auto& [id, weak] : identities_) {
      if (!weak.lock(rt).isObject()) dead.push_back(id);
    }
    for (uint64_t id : dead) identities_.erase(id);
  }
  identities_.insert_or_assign(instance->jsIdentity, jsi::WeakObject(rt, obj));
  return jsi::Value(rt, obj);
}

jsi::Value Host::errorToJs(jsi::Runtime& rt, const Error& e) {
  std::string name = e->name.toUtf8();
  const char* ctor = (name == "TypeError" || name == "RangeError") ? name.c_str() : "Error";
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
    std::string frames = firstFrame == std::string::npos ? "" : stack.substr(firstFrame);
    err.setProperty(rt, "stack", jsi::String::createFromUtf8(rt, head + "\n    at " + e->site.get().toUtf8() + frames));
  }
  return jsi::Value(rt, err);
}

Error Host::errorFromJs(jsi::Runtime& rt, const jsi::JSError& e) {
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
