#include "tally.hpp"

#include <cmath>
#include <stdexcept>

namespace tally {

namespace {
int liveCounters = 0;
}

Counter::Counter() : Counter(std::string("counter")) {}

Counter::Counter(int start) : Counter(std::string("counter")) { total_ = start; }

Counter::Counter(const std::string& name, double step) : name_(name), step_(step) { liveCounters++; }

Counter::Counter(const Counter& other)
    : name_(other.name_),
      step_(other.step_),
      total_(other.total_),
      history_(other.history_),
      tags_(other.tags_),
      note_(other.note_),
      rounding_(other.rounding_) {
  liveCounters++;
}

Counter::~Counter() { liveCounters--; }

double Counter::add(double by) {
  if (by < 0) throw std::invalid_argument("add takes a number of at least 0");
  double scaled = by * step_;
  double rounded = rounding_ == Rounding::Down ? std::floor(scaled)
                   : rounding_ == Rounding::Up ? std::ceil(scaled)
                                               : std::round(scaled);
  total_ += rounded;
  history_.push_back(rounded);
  return total_;
}

int64_t Counter::total() const { return static_cast<int64_t>(total_); }

std::string Counter::name() const { return name_; }

void Counter::rename(std::string_view name) { name_ = std::string(name); }

std::vector<double> Counter::history() const { return history_; }

std::vector<std::string> Counter::tags() const { return tags_; }

void Counter::tag(const std::vector<std::string>& tags) { tags_.insert(tags_.end(), tags.begin(), tags.end()); }

std::optional<std::string> Counter::note() const { return note_; }

void Counter::setNote(std::optional<std::string> note) { note_ = std::move(note); }

void Counter::setRounding(Rounding rounding) { rounding_ = rounding; }

Rounding Counter::rounding() const { return rounding_; }

void Counter::merge(const Counter& other) { total_ += other.total_; }

Counter Counter::split() {
  Counter half(name_ + "/2", step_);
  half.total_ = std::floor(total_ / 2);
  total_ -= half.total_;
  return half;
}

void Counter::fail() const { throw 42; }

void Counter::scale(int by) { step_ *= by; }

void Counter::scale(double by) { step_ *= by; }

Counter* Counter::self() { return this; }

int Counter::live() { return liveCounters; }

}  // namespace tally

extern "C" int tally_version(void) { return 3; }
