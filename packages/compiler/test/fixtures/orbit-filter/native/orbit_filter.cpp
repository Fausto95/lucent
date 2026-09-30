// The Orbit filter: C++ behind the C interface of orbit_filter.h. C++
// exceptions never cross it; each function turns them into an OrbitError.
#include "orbit_filter.h"

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>
#include <new>
#include <stdexcept>
#include <string>

namespace {

std::atomic<int32_t> live{0};

class Filter {
 public:
  explicit Filter(double strength) : strength_(strength) {
    if (!(strength >= 0 && strength <= 4)) throw std::invalid_argument("strength must be between 0 and 4");

    live++;
  }

  ~Filter() { live--; }

  size_t apply(const uint8_t* input, size_t n, uint8_t* output, size_t capacity) {
    if (capacity < n) throw std::length_error("output is shorter than input");

    for (size_t i = 0; i < n; i++) output[i] = static_cast<uint8_t>(std::min(255.0, std::floor(input[i] * strength_ + 0.5)));

    processed_ += n;
    return n;
  }

  uint64_t processed() const { return processed_; }

 private:
  double strength_;
  uint64_t processed_ = 0;
};

// The message stays valid until the next failure on this thread: the caller copies it first.
thread_local std::string lastMessage;

void report(OrbitError* error, int code, const char* message) {
  if (!error) return;

  lastMessage = message;
  error->code = code;
  error->message = lastMessage.c_str();
}

}  // namespace

struct OrbitFilter {
  Filter filter;
};

extern "C" OrbitFilter* orbit_filter_create(double strength, OrbitError* error) {
  try {
    return new OrbitFilter{Filter(strength)};
  } catch (const std::invalid_argument& e) {
    report(error, 1, e.what());
  } catch (const std::bad_alloc&) {
    report(error, 3, "out of memory");
  }

  return nullptr;
}

extern "C" void orbit_filter_destroy(OrbitFilter* filter) { delete filter; }

extern "C" int orbit_filter_apply(OrbitFilter* filter, const uint8_t* input, size_t input_length, uint8_t* output,
                                  size_t output_length, OrbitError* error) {
  try {
    return static_cast<int>(filter->filter.apply(input, input_length, output, output_length));
  } catch (const std::length_error& e) {
    report(error, 2, e.what());
  }

  return -1;
}

extern "C" uint64_t orbit_filter_processed(const OrbitFilter* filter) { return filter->filter.processed(); }

extern "C" int32_t orbit_filter_live(void) { return live.load(); }

extern "C" int32_t orbit_filter_label(const char* name) { return static_cast<int32_t>(std::strlen(name)); }

extern "C" void orbit_filter_each(OrbitFilter* filter, void (*visit)(uint8_t, void*), void* context) {}
