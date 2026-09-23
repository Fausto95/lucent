// Lucent runtime — function values.
#pragma once

#include <functional>
#include <memory>

#include "core.h"

namespace lucent {

template <class Sig>
class Fn;

/// A first-class function value. Copies alias the same function, so `===`
/// compares identity as in JavaScript.
template <class R, class... A>
class Fn<R(A...)> {
 public:
  using Signature = R(A...);
  Fn() = default;
  template <class F, std::enable_if_t<!std::is_same_v<std::decay_t<F>, Fn> && std::is_invocable_v<F&, A...>, int> = 0>
  Fn(F&& f) : f_(std::make_shared<std::function<R(A...)>>(std::forward<F>(f))) {}

  R operator()(A... args) const {
    if (!f_) throwTypeError("Called an uninitialized function value");
    return (*f_)(std::forward<A>(args)...);
  }
  explicit operator bool() const { return f_ != nullptr; }
  const void* identity() const { return f_.get(); }
  friend bool operator==(const Fn& a, const Fn& b) { return a.f_ == b.f_; }
  friend bool operator!=(const Fn& a, const Fn& b) { return a.f_ != b.f_; }

 private:
  std::shared_ptr<std::function<R(A...)>> f_;
};

/// Calls `f` with as many of (a, b, c) as it accepts, the way JavaScript
/// callbacks ignore extra arguments.
template <class F, class A, class B, class C>
decltype(auto) invokeCallback(F& f, A&& a, B&& b, C&& c) {
  if constexpr (std::is_invocable_v<F&, A, B, C>) {
    return f(std::forward<A>(a), std::forward<B>(b), std::forward<C>(c));
  } else if constexpr (std::is_invocable_v<F&, A, B>) {
    return f(std::forward<A>(a), std::forward<B>(b));
  } else if constexpr (std::is_invocable_v<F&, A>) {
    return f(std::forward<A>(a));
  } else {
    return f();
  }
}

template <class F, class A, class B, class C, class D>
decltype(auto) invokeCallback(F& f, A&& a, B&& b, C&& c, D&& d) {
  if constexpr (std::is_invocable_v<F&, A, B, C, D>) {
    return f(std::forward<A>(a), std::forward<B>(b), std::forward<C>(c), std::forward<D>(d));
  } else {
    return invokeCallback(f, std::forward<A>(a), std::forward<B>(b), std::forward<C>(c));
  }
}

}  // namespace lucent
