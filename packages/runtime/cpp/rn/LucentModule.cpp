#include "LucentModule.h"

#include <lucent/jsi/host.h>
#include <lucent/native.h>
#include <lucent/refs.h>

#include "LucentViewInstances.h"
#include "LucentViewRequests.h"

#include <string>

#if __has_include(<cxxreact/ReactNativeVersion.h>)
#include <cxxreact/ReactNativeVersion.h>
#endif

namespace facebook::react {

LucentModule::LucentModule(std::shared_ptr<CallInvoker> jsInvoker) : TurboModule(kModuleName, std::move(jsInvoker)) {
#ifdef REACT_NATIVE_VERSION_MINOR
  // The release this was compiled against, which the loader checks the
  // JavaScript's against.
  lucent::js::setReactNativeBuild(std::to_string(REACT_NATIVE_VERSION_MAJOR) + "." +
                                  std::to_string(REACT_NATIVE_VERSION_MINOR));
#endif
#ifndef NDEBUG
  // Lists the objects module code makes, for the cycle report at teardown.
  lucent::debug::trackObjects();
#endif
}

LucentModule::~LucentModule() {
  // Its runtime's instance ids name nothing from now on: a commit still
  // holding one (a reload's last frame) reads it as missing.
  if (host_) lucent::views::instanceIds().forget(host_->id());
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
    // Objects a cycle of strong references keeps for good, each cycle once
    // however many reloads keep finding it.
    for (const auto& cycle : lucent::debug::cycles(true)) {
      std::string report = lucent::debug::describe(cycle);
      std::string message = "[lucent] " + report;
      lucent::logError(message.c_str());
      // The next runtime's loader shows it in LogBox (__lucentDebug.cycles()).
      lucent::debug::keepReport(std::move(report));
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
  if (name == lucent::views::kInstanceName) return lucent::views::instanceIdFunction(host_, runtime);

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

        // The base its request ids start from: they name this runtime.
        return jsi::Value(lucent::views::connectRequests(host, rt, args[0].asObject(rt).asFunction(rt)));
      });
}

}  // namespace facebook::react
