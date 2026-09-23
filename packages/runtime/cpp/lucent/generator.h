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
#include <optional>
#include <tuple>
#include <utility>

#include "array.h"
#include "bytes.h"
#include "core.h"
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
};
template <class T>
using Iter = Ref<IterObject<T>>;

/// `{ value, done }` from `iterator.next()`.
template <class T>
struct IterResult {
  bool done = true;
  Opt<T> value;
};

template <class T>
IterResult<T> iterNext(const Iter<T>& it) {
  auto v = it->next();
  if (!v) return {};
  return IterResult<T>{false, Opt<T>(std::move(*v))};
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

namespace detail {

template <class T>
class GeneratorIter;

template <class T>
struct GeneratorPromise {
  std::optional<T> current;
  std::exception_ptr error;
  bool returning = false;

  Iter<T> get_return_object();
  std::suspend_always initial_suspend() noexcept { return {}; }
  std::suspend_always final_suspend() noexcept { return {}; }
  void return_void() {}
  void unhandled_exception() {
    try {
      throw;
    } catch (const GeneratorReturn&) {
      // return() finished running the finally blocks.
    } catch (...) {
      error = std::current_exception();
    }
  }

  struct Yield {
    GeneratorPromise& p;
    bool await_ready() const noexcept { return false; }
    void await_suspend(std::coroutine_handle<>) const noexcept {}
    void await_resume() const {
      if (p.returning) throw GeneratorReturn{};
    }
  };
  Yield yield_value(T v) {
    current = std::move(v);
    return Yield{*this};
  }
};

template <class T>
class GeneratorIter final : public IterObject<T> {
 public:
  using Handle = std::coroutine_handle<GeneratorPromise<T>>;
  explicit GeneratorIter(Handle h) : h_(h) {}
  ~GeneratorIter() override {
    if (h_) h_.destroy();
  }

  std::optional<T> next() override {
    if (done_) return std::nullopt;
    started_ = true;
    h_.resume();
    return settle();
  }

  void ret() override {
    if (done_) return;
    if (!started_) {
      done_ = true;
      return;
    }
    h_.promise().returning = true;
    h_.resume();
    settle();
    done_ = true;
  }

 private:
  std::optional<T> settle() {
    auto& p = h_.promise();
    if (h_.done()) {
      done_ = true;
      if (p.error) std::rethrow_exception(std::exchange(p.error, nullptr));
      return std::nullopt;
    }
    return std::exchange(p.current, std::nullopt);
  }

  Handle h_;
  bool started_ = false;
  bool done_ = false;
};

template <class T>
Iter<T> GeneratorPromise<T>::get_return_object() {
  return std::make_shared<GeneratorIter<T>>(GeneratorIter<T>::Handle::from_promise(*this));
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
Iter<double> iterOf(const Bytes& b);

/// `[...it]` / `Array.from(it)`.
template <class T>
Array<T> iterToArray(const Iter<T>& it) {
  Array<T> out;
  while (auto v = it->next()) out.push(std::move(*v));
  return out;
}

}  // namespace lucent

/// Coroutines declared to return Iter<T> are generators.
template <class T, class... Args>
struct std::coroutine_traits<lucent::Iter<T>, Args...> {
  using promise_type = lucent::detail::GeneratorPromise<T>;
};
