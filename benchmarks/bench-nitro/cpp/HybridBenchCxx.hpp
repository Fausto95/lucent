#pragma once

#include "HybridBenchCxxSpec.hpp"

namespace margelo::nitro::benchnitro {

class HybridBenchCxx : public HybridBenchCxxSpec {
public:
  HybridBenchCxx() : HybridObject(TAG) {}

  double addNumbers(double a, double b) override { return a + b; }
  std::string addStrings(const std::string& a, const std::string& b) override { return a + b; }
};

} // namespace margelo::nitro::benchnitro
