#include "LucentModule.h"

#include <lucent/jsi/host.h>
#include <lucent/native.h>

#include <string>

namespace facebook::react {

LucentModule::LucentModule(std::shared_ptr<CallInvoker> jsInvoker) : TurboModule(kModuleName, std::move(jsInvoker)) {}

LucentModule::~LucentModule() {
#ifndef NDEBUG
  // Platform objects Lucent still holds when the module goes (a reload, the
  // app's end): delegates and listeners never removed, cycles through them.
  if (long n = lucent::liveNativeRefs()) {
    std::string message = "[lucent] " + std::to_string(n) + " native reference(s) still held at teardown";
    lucent::logError(message.c_str());
  }
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
  return host_->module(runtime, propName.utf8(runtime));
}

}  // namespace facebook::react
