// Lucent runtime — function values.
#pragma once

#include <functional>
#include <memory>

#include "core.h"

namespace lucent {

template <class Sig>
class Fn;

namespace detail {

/// What a function value calls: the callable itself lives in the same
/// allocation as its reference count (make_shared of a Callable<F>), where a
/// shared std::function would be a second one for any capture past its
/// small buffer.
template <class R, class... A>
struct Callee {
  virtual ~Callee() = default;
  virtual R call(A... args) = 0;
};

template <class F, class R, class... A>
struct Callable final : Callee<R, A...> {
  template <class G>
  explicit Callable(G&& g) : f(std::forward<G>(g)) {}
  R call(A... args) override {
    if constexpr (std::is_void_v<R>) f(std::forward<A>(args)...);
    else return f(std::forward<A>(args)...);
  }
  F f;
};

}  // namespace detail

/// A first-class function value. Copies alias the same function, so `===`
/// compares identity as in JavaScript. Making one allocates once.
template <class R, class... A>
class Fn<R(A...)> {
 public:
  using Signature = R(A...);
  Fn() = default;
  template <class F, std::enable_if_t<!std::is_same_v<std::decay_t<F>, Fn> && std::is_invocable_v<F&, A...>, int> = 0>
  Fn(F&& f) : f_(std::make_shared<detail::Callable<std::decay_t<F>, R, A...>>(std::forward<F>(f))) {}

  R operator()(A... args) const {
    if (!f_) throwTypeError("Called an uninitialized function value");
    return f_->call(std::forward<A>(args)...);
  }
  explicit operator bool() const { return f_ != nullptr; }
  const void* identity() const { return f_.get(); }
  friend bool operator==(const Fn& a, const Fn& b) { return a.f_ == b.f_; }
  friend bool operator!=(const Fn& a, const Fn& b) { return a.f_ != b.f_; }

 private:
  std::shared_ptr<detail::Callee<R, A...>> f_;
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
