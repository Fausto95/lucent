// The React Native entry point: a pure C++ TurboModule named "Lucent".
//
// JavaScript reaches a Lucent module with
//   TurboModuleRegistry.getEnforcing("Lucent").<moduleName>
// which lands in create() below. It is autolinked:
//   * iOS: registered in the global C++ module map at load time
//     (LucentRegistration.mm);
//   * Android: through React Native's C++ module autolinking
//     (cxxModuleHeaderName = LucentModule).
#pragma once

#include <ReactCommon/TurboModule.h>
#include <jsi/jsi.h>

#include <memory>

namespace lucent::js {
class Host;
}

namespace facebook::react {

class LucentModule : public TurboModule {
 public:
  static constexpr const char* kModuleName = "Lucent";

  explicit LucentModule(std::shared_ptr<CallInvoker> jsInvoker);
  ~LucentModule() override;

 protected:
  jsi::Value create(jsi::Runtime& runtime, const jsi::PropNameID& propName) override;

 private:
  std::shared_ptr<lucent::js::Host> host_;
};

}  // namespace facebook::react
