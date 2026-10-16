// A C++ library a Lucent package wraps (decision 0125): a class with
// overloads, default arguments, strings, vectors, optionals and an enum,
// a method that returns a new object, and ones that throw.
#pragma once

#include <cstdint>
#include <optional>
#include <string>
#include <string_view>
#include <vector>

namespace tally {

enum class Rounding { Down, Nearest = 2, Up };

class Counter {
 public:
  Counter();
  explicit Counter(int start);
  Counter(const std::string& name, double step = 1.0);
  Counter(const Counter& other);
  ~Counter();

  /// Adds `by`, rounded as the counter rounds; std::invalid_argument when it is negative.
  double add(double by);
  int64_t total() const;
  std::string name() const;
  void rename(std::string_view name);
  std::vector<double> history() const;
  std::vector<std::string> tags() const;
  void tag(const std::vector<std::string>& tags);
  std::optional<std::string> note() const;
  void setNote(std::optional<std::string> note);
  void setRounding(Rounding rounding);
  Rounding rounding() const;
  /// Adds `other`'s total to this one's.
  void merge(const Counter& other);
  /// A new counter holding half of this one's total, which keeps the rest.
  Counter split();
  /// Throws something that is no std::exception.
  void fail() const;
  /// Two overloads TypeScript can't tell apart: neither is bound.
  void scale(int by);
  void scale(double by);
  /// Whose memory this is, Lucent can't know.
  Counter* self();
  static int live();

 private:
  std::string name_;
  double step_ = 1.0;
  double total_ = 0;
  std::vector<double> history_;
  std::vector<std::string> tags_;
  std::optional<std::string> note_;
  Rounding rounding_ = Rounding::Nearest;
};

}  // namespace tally

extern "C" {
int tally_version(void);
}
