#pragma once

#include <memory>
#include <string>

#include "BenchTurboCxxSpecJSI.h"

namespace facebook::react {

/** NitroBenchmarks' MyCxxTurboModule. */
class BenchTurboCxx : public NativeBenchTurboCxxCxxSpec<BenchTurboCxx> {
 public:
  explicit BenchTurboCxx(std::shared_ptr<CallInvoker> jsInvoker)
      : NativeBenchTurboCxxCxxSpec(std::move(jsInvoker)) {}

  double addNumbers(jsi::Runtime&, double a, double b) { return a + b; }
  std::string addStrings(jsi::Runtime&, std::string a, std::string b) { return a + b; }
};

} // namespace facebook::react
