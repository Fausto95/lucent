#include "LucentModule.h"

#include <lucent/jsi/host.h>
#include <lucent/native.h>

#include "LucentViewRequests.h"

#include <string>

namespace facebook::react {

LucentModule::LucentModule(std::shared_ptr<CallInvoker> jsInvoker) : TurboModule(kModuleName, std::move(jsInvoker)) {}

LucentModule::~LucentModule() {
#ifndef NDEBUG
  // Platform objects module code still holds when the module goes (a
  // reload, the app's end): module state, delegates and listeners never
  // removed, cycles through them. Not the views': the renderer releases
  // them with its views, and the platform's garbage collector the
  // callbacks their setups gave it, on their own schedule. Counted once
  // the module context has run what the teardown left it.
  lucent::postCallback([] {
    if (long n = lucent::moduleNativeRefs()) {
      std::string message = "[lucent] " + std::to_string(n) + " native reference(s) module code still holds at teardown";
      lucent::logError(message.c_str());
    }
  });
#endif
}

jsi::Value LucentModule::create(jsi::Runtime& runtime, const jsi::PropNameID& propName) {
  if (!host_) {
    std::weak_ptr<CallInvoker> invoker = jsInvoker_;
    host_ = lucent::js::Host::create(runtime, [invoker](lucent::js::JsTask task) {
      if (auto i = invoker.lock()) {
        i->invokeAsync([task = std::move(task)](jsi::Runtime& rt) { task(rt); });
      }
    });
  }
  auto name = propName.utf8(runtime);

  if (name == lucent::views::kRequestsName) return requestsConnector(runtime);

  return host_->module(runtime, name);
}

jsi::Value LucentModule::requestsConnector(jsi::Runtime& runtime) {
  std::weak_ptr<lucent::js::Host> weak = host_;

  return jsi::Function::createFromHostFunction(
      runtime,
      jsi::PropNameID::forAscii(runtime, lucent::views::kRequestsName),
      1,
      [weak](jsi::Runtime& rt, const jsi::Value&, const jsi::Value* args, size_t count) -> jsi::Value {
        auto host = weak.lock();

        if (!host || count < 1 || !args[0].isObject() || !args[0].asObject(rt).isFunction(rt))
          throw jsi::JSError(rt, "Lucent: __lucentViewRequests takes the function that settles view requests");

        lucent::views::connectRequests(host, rt, args[0].asObject(rt).asFunction(rt));
        return jsi::Value::undefined();
      });
}

}  // namespace facebook::react
