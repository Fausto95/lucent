// React Native's autolinking calls <libraryName>_ModuleProvider for Java
// TurboModules. This package has none (its module is pure C++), so this
// returns null; the C++ provider finds BenchTurboCxx by kModuleName.
#pragma once

#include <ReactCommon/JavaTurboModule.h>

#include <memory>
#include <string>

namespace facebook::react {

inline std::shared_ptr<TurboModule> benchturbocxxnative_ModuleProvider(const std::string&, const JavaTurboModule::InitParams&) {
  return nullptr;
}

}  // namespace facebook::react
