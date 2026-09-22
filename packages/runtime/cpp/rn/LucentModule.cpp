#include "LucentModule.h"

#include <lucent/jsi/host.h>

namespace facebook::react {

LucentModule::LucentModule(std::shared_ptr<CallInvoker> jsInvoker) : TurboModule(kModuleName, std::move(jsInvoker)) {}

LucentModule::~LucentModule() = default;

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
