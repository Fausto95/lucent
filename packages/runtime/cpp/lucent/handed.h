// Lucent runtime — a function on an executor kept in a const.
#pragma once

#include <memory>
#include <mutex>
#include <string>
#include <string_view>
#include <utility>
#include <vector>

#include "execution.h"
#include "function.h"
#include "native.h"

namespace lucent {

template <class Sig>
class HandedFunction;

/// lucent:thread's `const f = on(executor, g)`: `g`, with the executor it
/// goes on, which each place `f` is handed to the platform converts it on.
/// A platform that makes a new object for each conversion (an Objective-C
/// block) keeps the one it made for each type it was handed as, so every
/// hand-over gives the same object; an Android proxy is already one per
/// function and executor while Java holds it.
template <class R, class... A>
class HandedFunction<R(A...)> {
 public:
  HandedFunction(Fn<R(A...)> f, std::shared_ptr<ExecutorContext> executor) : f(std::move(f)), executor(std::move(executor)) {}

  /// The function the platform calls, which holds no reference to this.
  Fn<R(A...)> f;
  std::shared_ptr<ExecutorContext> executor;

  /// What the platform made of `f` as `type`: made by `make` at the first
  /// hand-over as that type, the same object at every later one.
  template <class Make>
  NativeRef madeAs(std::string_view type, Make&& make) const {
    std::lock_guard<std::mutex> g(made_->mutex);
    for (auto& [t, ref] : made_->objects)
      if (t == type) return ref;
    NativeRef ref = make();
    made_->objects.emplace_back(std::string(type), ref);
    return ref;
  }

  R operator()(A... args) const { return f(std::forward<A>(args)...); }

  void lucentRefs_(debug::RefSink& s, const char* name, const char* where) const { f.lucentRefs_(s, name, where); }

 private:
  struct Made {
    std::mutex mutex;
    std::vector<std::pair<std::string, NativeRef>> objects;
  };
  std::shared_ptr<Made> made_ = std::make_shared<Made>();
};

/// `const f = on(executor, g)`: a function value of `g`'s type that keeps
/// its executor, and the objects the platform made of it, for each place
/// it is handed over (handedOf).
template <class R, class... A>
Fn<R(A...)> handedFunction(std::shared_ptr<ExecutorContext> executor, Fn<R(A...)> f) {
  return Fn<R(A...)>(HandedFunction<R(A...)>(std::move(f), std::move(executor)));
}

/// What a function `handedFunction` made holds: its function and executor.
template <class R, class... A>
const HandedFunction<R(A...)>& handedOf(const Fn<R(A...)>& f) {
  auto* h = f.template target<HandedFunction<R(A...)>>();
  if (!h) throwTypeError("This function was not put on an executor with on()");
  return *h;
}

}  // namespace lucent
