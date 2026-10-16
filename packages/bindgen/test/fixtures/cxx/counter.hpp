// A C++ header as a package wraps one (decision 0125): classes in a
// namespace, their overloads and types, and what Lucent leaves out.
#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace acme {

enum class Mode { Fast, Exact = 4, Gentle };

enum Level { Low = -1, High = 1 };

class Counter {
 public:
  Counter();
  explicit Counter(int start);
  Counter(const std::string& name, double step = 1.0);
  Counter(const Counter& other);
  Counter(Counter&& other) noexcept;
  ~Counter();

  int64_t bump(int by);
  double value() const;
  std::string name() const;
  void rename(std::string_view name);
  void label(const char* label);
  std::vector<double> history() const;
  const std::vector<std::string>& tags() const;
  std::optional<std::string> note() const;
  void setMode(Mode mode);
  Mode mode() const;
  Level level() const;
  void merge(const Counter& other);
  Counter split();
  static Counter* shared();
  static int count();
  bool operator==(const Counter& other) const;
  template <class T>
  T as() const;
  void* raw();
  void each(const std::function<void(double, const std::string&)>& visit) const;
  int countIf(std::function<bool(int64_t)> keep);
  void onTick(std::function<void()> tick);
  void legacy(void (*visit)(int, void*), void* context);
  int countUntil(int most, const std::atomic<bool>& stop);
  Counter& operator=(const Counter&) = delete;

 private:
  void hidden();
  int secret_ = 0;
};

struct Point {
  double x() const;
};

class Derived : public Counter {
 public:
  Derived();
};

class Shape {
 public:
  virtual double area() const = 0;
};

template <class T>
class Box {
 public:
  T get() const;
};

std::string greet(const std::string& who);

namespace {
class Hidden {
 public:
  Hidden();
};
}  // namespace

}  // namespace acme

extern "C" {
int acme_version(void);
}
