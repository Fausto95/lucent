// Lucent runtime — iterators and generators.
//
// Every iterable value is an Iter<T>: a shared iterator with next() and
// ret() (JavaScript's iterator.return()). Generator functions are C++20
// coroutines whose declared return type is Iter<T> (see the coroutine_traits
// specialization below); they start lazily, like JavaScript generators.
//
// ret() resumes a suspended generator with a flag that makes its pending
// co_yield throw GeneratorReturn. That unwinds through the generated
// `finally` blocks (JS `catch` blocks let it pass), and the coroutine then
// completes normally.
#pragma once

#include <coroutine>
#include <exception>
#include <memory>
#include <optional>
#include <tuple>
#include <utility>

#include "array.h"
#include "bytes.h"
#include "core.h"
#include "jserror.h"
#include "jsstring.h"
#include "map.h"

namespace lucent {

/// Thrown into a generator by iterator.return(); never seen by JS catch blocks.
struct GeneratorReturn {};

template <class T>
class IterObject : public Object {
 public:
  /// The next value, or nullopt once the iterator is exhausted.
  virtual std::optional<T> next() = 0;
  /// iterator.return(): stops early, running a generator's finally blocks.
  virtual void ret() {}
  /// iterator.throw(e), as `yield*` passes it on: a generator throws `e`
  /// where it waits, and gives its next value (nullopt once done). An
  /// iterator without throw() is closed, and the error is a TypeError.
  virtual std::optional<T> throwIn(const Error& e) {
    (void)e;
    ret();
    throwTypeError("The iterator does not provide a 'throw' method");
  }
};
template <class T>
using Iter = Ref<IterObject<T>>;

/// A generator whose `yield` gives what next(v) sends (an N), or whose
/// body returns a value (an R): `Generator<T, R, N>`. One with neither is an
/// Iter<T>. A generator's next() without a value sends undefined: an N
/// without undefined reads as its default, as an unassigned field does.
template <class T, class R, class N>
class GenObject : public IterObject<T> {
 public:
  /// next(v): its next value, nullopt once done.
  virtual std::optional<T> send(std::optional<N> v) = 0;
  /// return(v): ends it, running its finally blocks; nullopt once done,
  /// or a value one of them yields.
  virtual std::optional<T> retWith(std::optional<R> v) = 0;
  /// What it returned, when the step that ended it reports it.
  virtual std::optional<R> result() = 0;
};
template <class T, class R, class N>
using Gen = Ref<GenObject<T, R, N>>;

/// `{ value, done }` from `iterator.next()`.
template <class T>
struct IterResult {
  bool done = true;
  Opt<T> value;
};

/// `{ value, done }` from a Generator<T, R, N>'s next(), return() or
/// throw(): a value it yields, or once done, what it returned (reported
/// once; undefined after).
template <class T, class R>
struct GenResult {
  bool done = true;
  Opt<T> value;
  /// Done with what it returned, `returned`.
  bool returns = false;
  R returned{};
};

template <class T>
IterResult<T> iterNext(const Iter<T>& it) {
  auto v = it->next();
  if (!v) return {};
  return IterResult<T>{false, Opt<T>(std::move(*v))};
}

/// A generator's throw(e): `{ value, done }`; what it throws, thrown.
template <class T>
IterResult<T> iterThrow(const Iter<T>& it, const Error& e) {
  auto v = it->throwIn(e);
  if (!v) return {};
  return IterResult<T>{false, Opt<T>(std::move(*v))};
}

/// A generator's step: a GenResult, or without a result type an IterResult.
template <class T, class R>
using GenStep = std::conditional_t<std::is_same_v<R, Undefined>, IterResult<T>, GenResult<T, R>>;

namespace detail {
template <class T, class R, class N>
GenStep<T, R> genResult(GenObject<T, R, N>& g, std::optional<T> v) {
  GenStep<T, R> out;
  if (v) {
    out.done = false;
    out.value = Opt<T>(std::move(*v));
  } else if constexpr (!std::is_same_v<R, Undefined>) {
    if (auto r = g.result()) {
      out.returns = true;
      out.returned = std::move(*r);
    }
  }
  return out;
}
}  // namespace detail

/// g.next() and g.next(v).
template <class T, class R, class N>
GenStep<T, R> genNext(const Gen<T, R, N>& g) {
  return detail::genResult(*g, g->send(std::nullopt));
}
template <class T, class R, class N, class V>
GenStep<T, R> genNext(const Gen<T, R, N>& g, V&& v) {
  return detail::genResult(*g, g->send(std::optional<N>(N(std::forward<V>(v)))));
}
/// g.return(v).
template <class T, class R, class N, class V>
GenStep<T, R> genReturn(const Gen<T, R, N>& g, V&& v) {
  return detail::genResult(*g, g->retWith(std::optional<R>(R(std::forward<V>(v)))));
}
/// g.throw(e).
template <class T, class R, class N>
GenStep<T, R> genThrow(const Gen<T, R, N>& g, const Error& e) {
  return detail::genResult(*g, g->throwIn(e));
}

template <class T, class R, class N>
Iter<T> iterOf(const Gen<T, R, N>& g) {
  return g;
}

/// Calls ret() when a for-of or yield* exits before its iterator is exhausted.
template <class T>
class IterCloser {
 public:
  explicit IterCloser(Iter<T> it) : it_(std::move(it)), exceptions_(std::uncaught_exceptions()) {}
  /// The iterator reported done: nothing to close.
  void exhausted() { it_ = nullptr; }
  ~IterCloser() noexcept(false) {
    if (!it_) return;
    if (std::uncaught_exceptions() > exceptions_) {
      // Leaving because of an exception: it wins over one from return().
      try {
        it_->ret();
      } catch (...) {
      }
    } else {
      it_->ret();
    }
  }
  IterCloser(const IterCloser&) = delete;
  IterCloser& operator=(const IterCloser&) = delete;

 private:
  Iter<T> it_;
  int exceptions_;
};

/// `yield* inner`: the generator hands its requests to `inner` until it is done.
template <class D>
struct YieldFrom {
  D inner;
};
template <class D>
YieldFrom<std::decay_t<D>> yieldFrom(D&& inner) {
  return YieldFrom<std::decay_t<D>>{std::forward<D>(inner)};
}

namespace detail {

template <class T, class R, class N>
class GeneratorIter;

/// The iterator a generator's `yield*` hands its requests to.
template <class T, class N>
struct Delegation {
  virtual ~Delegation() = default;
  /// next(v): its next value, nullopt once done.
  virtual std::optional<T> next(std::optional<N> sent) = 0;
  /// throw(e): its next value, nullopt once done; what it throws, thrown.
  virtual std::optional<T> throwIn(const Error& e) = 0;
  /// return(): closes it.
  virtual void ret() = 0;
};

template <class T, class N, class D>
struct Forward;

/// To an iterable's iterator, which takes no value: what next(v) sends goes nowhere.
template <class T, class N>
struct Forward<T, N, Iter<T>> final : Delegation<T, N> {
  explicit Forward(Iter<T> it) : it(std::move(it)) {}
  std::optional<T> next(std::optional<N>) override { return it->next(); }
  std::optional<T> throwIn(const Error& e) override { return it->throwIn(e); }
  void ret() override { it->ret(); }
  Undefined result() { return {}; }
  Iter<T> it;
};

/// To a generator of values or a result: what next(v) sends, when it takes values (the same N).
template <class T, class N, class R2, class N2>
struct Forward<T, N, Gen<T, R2, N2>> final : Delegation<T, N> {
  explicit Forward(Gen<T, R2, N2> g) : g(std::move(g)) {}
  std::optional<T> next(std::optional<N> sent) override {
    if constexpr (std::is_same_v<N2, Undefined>)
      return g->next();
    else
      return g->send(std::move(sent));
  }
  std::optional<T> throwIn(const Error& e) override { return g->throwIn(e); }
  void ret() override { g->ret(); }
  /// The value of `yield*`: what it returned.
  R2 result() {
    auto r = g->result();
    return r ? std::move(*r) : R2{};
  }
  Gen<T, R2, N2> g;
};

/// co_return: a value when the generator has a result type.
template <class R, class P>
struct GeneratorReturns {
  void return_value(R v) { static_cast<P*>(this)->result = std::move(v); }
};
template <class P>
struct GeneratorReturns<Undefined, P> {
  void return_void() {}
};

template <class T, class R, class N>
struct GeneratorPromise : GeneratorReturns<R, GeneratorPromise<T, R, N>> {
  std::optional<T> current;
  /// What the body threw, for the request it ran for.
  std::exception_ptr error;
  /// throw(e): thrown where the body waits.
  std::exception_ptr thrown;
  /// return(): the pending yield throws GeneratorReturn, once.
  bool returning = false;
  /// What next(v) sent, for the yield the body waits at.
  std::optional<N> sent;
  /// What it returned (or what return(v) gave).
  std::optional<R> result;
  /// The iterator a `yield*` hands requests to, while it runs.
  std::unique_ptr<Delegation<T, N>> delegation;

  Ref<GeneratorIter<T, R, N>> get_return_object();
  std::suspend_always initial_suspend() noexcept { return {}; }
  std::suspend_always final_suspend() noexcept { return {}; }
  void unhandled_exception() {
    try {
      throw;
    } catch (const GeneratorReturn&) {
      // return() finished running the finally blocks.
    } catch (...) {
      error = std::current_exception();
    }
  }

  /// Where the body resumes after a yield: what throw() or return() brings.
  void resumed() {
    if (thrown) std::rethrow_exception(std::exchange(thrown, nullptr));
    if (std::exchange(returning, false)) throw GeneratorReturn{};
  }

  struct Yield {
    GeneratorPromise& p;
    bool await_ready() const noexcept { return false; }
    void await_suspend(std::coroutine_handle<>) const noexcept {}
    /// The value of `yield v`: what next(v) sent.
    N await_resume() const {
      p.resumed();
      if constexpr (std::is_same_v<N, Undefined>) {
        return {};
      } else {
        auto v = std::exchange(p.sent, std::nullopt);
        return v ? std::move(*v) : N{};
      }
    }
  };
  Yield yield_value(T v) {
    current = std::move(v);
    return Yield{*this};
  }

  /// `yield* inner`: its first value answers the request the body runs for;
  /// once it is done, the value of `yield*` is what it returned.
  template <class D>
  struct Delegated {
    GeneratorPromise& p;
    Forward<T, N, D>* to;
    bool done;
    bool await_ready() const noexcept { return done; }
    void await_suspend(std::coroutine_handle<>) const noexcept {}
    auto await_resume() const {
      auto r = to->result();
      p.delegation.reset();
      p.resumed();
      return r;
    }
  };
  template <class D>
  Delegated<D> yield_value(YieldFrom<D> d) {
    auto to = std::make_unique<Forward<T, N, D>>(std::move(d.inner));
    auto* f = to.get();
    delegation = std::move(to);
    current = f->next(std::nullopt);
    return Delegated<D>{*this, f, !current.has_value()};
  }
};

template <class T, class R, class N>
class GeneratorIter final : public GenObject<T, R, N> {
 public:
  using Handle = std::coroutine_handle<GeneratorPromise<T, R, N>>;
  explicit GeneratorIter(Handle h) : h_(h) {}
  ~GeneratorIter() override {
    if (h_) h_.destroy();
  }

  std::optional<T> next() override { return send(std::nullopt); }

  std::optional<T> send(std::optional<N> v) override {
    if (done_) return std::nullopt;
    auto& p = h_.promise();
    if (p.delegation) {
      std::optional<T> out;
      try {
        out = p.delegation->next(std::move(v));
      } catch (...) {
        return resumeThrowing(std::current_exception());
      }
      if (out) return out;
      return resume();
    }
    // The first next()'s value goes nowhere: no yield waits for it.
    if (started_) p.sent = std::move(v);
    started_ = true;
    return resume();
  }

  std::optional<T> throwIn(const Error& e) override {
    // Not started, or done: it ends, and throws the error.
    if (!started_ || done_) {
      done_ = true;
      throwError(e);
    }
    auto& p = h_.promise();
    if (p.delegation) {
      std::optional<T> out;
      try {
        out = p.delegation->throwIn(e);
      } catch (...) {
        return resumeThrowing(std::current_exception());
      }
      if (out) return out;
      return resume();
    }
    return resumeThrowing(std::make_exception_ptr(Exception(e)));
  }

  void ret() override {
    if (done_) return;
    if (!started_) {
      done_ = true;
      return;
    }
    auto& p = h_.promise();
    if (p.delegation) p.delegation->ret();
    p.returning = true;
    resume();
    done_ = true;
  }

  std::optional<T> retWith(std::optional<R> v) override {
    auto& p = h_.promise();
    if (!started_ || done_) {
      done_ = true;
      p.result = std::move(v);
      reported_ = false;
      return std::nullopt;
    }
    if (p.delegation) {
      try {
        p.delegation->ret();
      } catch (...) {
        return resumeThrowing(std::current_exception());
      }
    }
    p.returning = true;
    p.result = std::move(v);
    return resume();
  }

  std::optional<R> result() override {
    // Reported once: a later step is done with undefined.
    if (std::exchange(reported_, true)) return std::nullopt;
    return std::exchange(h_.promise().result, std::nullopt);
  }

 private:
  std::optional<T> resume() {
    reported_ = false;
    h_.resume();
    return settle();
  }

  std::optional<T> resumeThrowing(std::exception_ptr e) {
    h_.promise().thrown = std::move(e);
    return resume();
  }

  std::optional<T> settle() {
    auto& p = h_.promise();
    if (h_.done()) {
      done_ = true;
      if (p.error) std::rethrow_exception(std::exchange(p.error, nullptr));
      return std::nullopt;
    }
    reported_ = true;
    return std::exchange(p.current, std::nullopt);
  }

  Handle h_;
  bool started_ = false;
  bool done_ = false;
  /// Whether the result was reported (or there is none to report: it yielded).
  bool reported_ = true;
};

template <class T, class R, class N>
Ref<GeneratorIter<T, R, N>> GeneratorPromise<T, R, N>::get_return_object() {
  return std::make_shared<GeneratorIter<T, R, N>>(GeneratorIter<T, R, N>::Handle::from_promise(*this));
}

// --- iterators over collections (live, like JavaScript's) --------------------------------------

template <class T>
class ArrayIter final : public IterObject<T> {
 public:
  explicit ArrayIter(Array<T> a) : a_(std::move(a)) {}
  std::optional<T> next() override {
    if (i_ >= a_.size()) return std::nullopt;
    return a_.at(i_++);
  }

 private:
  Array<T> a_;
  size_t i_ = 0;
};

template <class T, class Table, class Get>
class TableIter final : public IterObject<T> {
 public:
  TableIter(Table t, Get get) : t_(std::move(t)), get_(get) {}
  std::optional<T> next() override {
    auto& table = t_.table();
    while (i_ < table.slotCount()) {
      size_t i = i_++;
      if (table.slotLive(i)) return get_(table.slot(i));
    }
    return std::nullopt;
  }

 private:
  Table t_;
  Get get_;
  size_t i_ = 0;
};

}  // namespace detail

template <class T>
Iter<T> iterOf(const Iter<T>& it) {
  return it;
}
template <class T>
Iter<T> iterOf(const Array<T>& a) {
  return std::make_shared<detail::ArrayIter<T>>(a);
}
template <class T>
Iter<T> iterOf(const Set<T>& s) {
  auto get = [](const auto& slot) { return slot.key; };
  return std::make_shared<detail::TableIter<T, Set<T>, decltype(get)>>(s, get);
}
template <class K, class V>
Iter<std::tuple<K, V>> iterOf(const Map<K, V>& m) {
  auto get = [](const auto& slot) { return std::tuple<K, V>(slot.key, slot.value); };
  return std::make_shared<detail::TableIter<std::tuple<K, V>, Map<K, V>, decltype(get)>>(m, get);
}
/// Strings iterate by code point.
Iter<String> iterOf(const String& s);
namespace detail {
/// A typed array's elements, in order.
template <class K>
class TypedIter final : public IterObject<typename K::V> {
 public:
  explicit TypedIter(TypedArray<K> a) : a_(std::move(a)) {}
  std::optional<typename K::V> next() override {
    if (i_ >= a_.size()) return std::nullopt;
    return a_.at(i_++);
  }

 private:
  TypedArray<K> a_;
  size_t i_ = 0;
};
}  // namespace detail

template <class K>
Iter<typename K::V> iterOf(const TypedArray<K>& a) {
  return std::make_shared<detail::TypedIter<K>>(a);
}

/// `[...it]` / `Array.from(it)`.
template <class T>
Array<T> iterToArray(const Iter<T>& it) {
  Array<T> out;
  while (auto v = it->next()) out.push(std::move(*v));
  return out;
}
template <class T, class R, class N>
Array<T> iterToArray(const Gen<T, R, N>& g) {
  return iterToArray(Iter<T>(g));
}

}  // namespace lucent

/// Coroutines declared to return Iter<T> are generators; Gen<T, R, N>, generators with values.
template <class T, class... Args>
struct std::coroutine_traits<lucent::Iter<T>, Args...> {
  using promise_type = lucent::detail::GeneratorPromise<T, lucent::Undefined, lucent::Undefined>;
};
template <class T, class R, class N, class... Args>
struct std::coroutine_traits<lucent::Gen<T, R, N>, Args...> {
  using promise_type = lucent::detail::GeneratorPromise<T, R, N>;
};
