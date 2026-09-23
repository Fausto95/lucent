// React Native's autolinking calls <libraryName>_ModuleProvider for Java
// TurboModules. Lucent has none (its module is pure C++), so this returns null.
#pragma once

#include <ReactCommon/JavaTurboModule.h>

#include <memory>
#include <string>

namespace facebook::react {

inline std::shared_ptr<TurboModule> lucentnative_ModuleProvider(const std::string&, const JavaTurboModule::InitParams&) {
  return nullptr;
}

}  // namespace facebook::react
