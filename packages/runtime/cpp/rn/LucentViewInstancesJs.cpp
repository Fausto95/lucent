// The JavaScript side of instance ids (LucentViewInstances.h): the Lucent
// module's __lucentViewInstance. Apart from the registry, which plain C++
// (a mount's test, a host without JavaScript) links alone.
#include "LucentViewInstances.h"

#include <jsi/jsi.h>
#include <lucent/jsi/host.h>

#include <string>
#include <utility>

namespace lucent::views {

namespace jsi = facebook::jsi;

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
