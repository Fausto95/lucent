// Lucent runtime — what only the app delegate, or a scene delegate,
// receives (T110, decision 0076): a URL to open, a user activity, a push
// token, a remote notification, a background URL session's events, a home
// screen shortcut. The platform adapter (lucent/platform/ios_ui.mm) reports
// each on the main thread, as the delegate method the app forwards is
// called; Lucent code subscribes, and its answers merge into the one the
// platform waits for. Nothing here knows UIKit.
#pragma once

#include <atomic>
#include <cstdint>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <optional>
#include <stdexcept>
#include <type_traits>
#include <utility>
#include <vector>

#include "execution.h"
#include "report.h"
#include "resource.h"
#include "scope.h"

namespace lucent {

/// UIBackgroundFetchResult, numbered as UIKit numbers it.
enum class FetchResult : uint8_t { NewData = 0, NoData = 1, Failed = 2 };

/// The modules' answers to a remote notification or a background fetch, as
/// Expo merges its subscribers': new data if any had some, else failed if
/// any failed, else no data (none answering included).
inline FetchResult mergeFetchResults(const std::vector<FetchResult>& answers) {
  bool failed = false;
  for (FetchResult a : answers) {
    if (a == FetchResult::NewData) return FetchResult::NewData;
    failed = failed || a == FetchResult::Failed;
  }
  return failed ? FetchResult::Failed : FetchResult::NoData;
}

/// Whether any module handled a URL, a user activity or a shortcut.
inline bool anyHandled(const std::vector<bool>& answers) {
  for (bool a : answers)
    if (a) return true;
  return false;
}

/// The answers a fetch's subscribers give later, each once (its `reply()`):
/// `done` runs once, with their merge, when every one has answered or when
/// the adapter calls `expire()` at the platform's deadline, those still
/// owing counted as no data. Any thread.
class FetchAnswers : public std::enable_shared_from_this<FetchAnswers> {
 public:
  using Done = std::function<void(FetchResult)>;

  static std::shared_ptr<FetchAnswers> start(Done done) {
    return std::shared_ptr<FetchAnswers>(new FetchAnswers(std::move(done)));
  }

  /// One subscriber's answer: the first call counts, later ones do nothing.
  std::function<void(FetchResult)> reply() {
    {
      std::lock_guard<std::mutex> g(m_);
      owed_++;
    }
    auto self = shared_from_this();
    auto once = std::make_shared<std::atomic<bool>>(false);
    return [self, once](FetchResult answer) {
      if (once->exchange(true)) return;
      self->answer(answer);
    };
  }

  /// No more subscribers: with none owing, `done` runs now.
  void close() {
    std::unique_lock<std::mutex> g(m_);
    closed_ = true;
    finishIfDone(g);
  }

  /// The platform's deadline: `done` runs now with what came, if it hasn't.
  void expire() {
    std::unique_lock<std::mutex> g(m_);
    closed_ = true;
    owed_ = 0;
    finishIfDone(g);
  }

 private:
  explicit FetchAnswers(Done done) : done_(std::move(done)) {}

  void answer(FetchResult a) {
    std::unique_lock<std::mutex> g(m_);
    if (finished_) return;
    answers_.push_back(a);
    if (owed_ > 0) owed_--;
    finishIfDone(g);
  }

  void finishIfDone(std::unique_lock<std::mutex>& g) {
    if (finished_ || !closed_ || owed_ > 0) return;
    finished_ = true;
    FetchResult merged = mergeFetchResults(answers_);
    Done done = std::move(done_);
    g.unlock();
    try {
      if (done) done(merged);
    } catch (...) {
      reportUncaught(std::current_exception(), "app delegate answer");
    }
  }

  std::mutex m_;
  Done done_;
  std::vector<FetchResult> answers_;
  size_t owed_ = 0;
  bool closed_ = false;
  bool finished_ = false;
};

/// One delegate event Lucent code subscribes to: `P` is what each
/// subscriber hears, `A` what it answers (`void` for nothing). The adapter
/// reports it on the main thread, and each listener runs there, in the
/// order they subscribed; what one throws is reported, and it answers
/// nothing. An event that can launch the app (`keep`: a URL, an activity, a
/// shortcut) and finds no subscriber is kept until the first one, which
/// hears it on the main thread once it subscribes; its answer comes too late
/// for the platform, which launched the app already.
template <class P, class A = void>
class DelegateEvent {
 public:
  using Listener = std::function<A(const P&)>;
  using Answers = std::conditional_t<std::is_void_v<A>, void, std::vector<A>>;

  explicit DelegateEvent(bool keep = false) : state_(std::make_shared<State>()) { state_->keep = keep; }

  DelegateEvent(const DelegateEvent&) = delete;
  DelegateEvent& operator=(const DelegateEvent&) = delete;

  /// Calls `listener` on each report from now on, on the main thread, and
  /// first with what was kept for the first subscriber. Open until it is
  /// closed or `scope` is disposed; dropping the handle does not end it.
  std::shared_ptr<Resource> subscribe(Listener listener, const std::shared_ptr<Scope>& scope = nullptr) {
    if (!listener) throw std::invalid_argument("A delegate event listener must be a function");

    auto entry = std::make_shared<Entry>();
    entry->listener = std::move(listener);
    uint64_t id;
    {
      std::lock_guard<std::mutex> g(state_->m);
      id = state_->next++;
    }

    std::weak_ptr<State> weak = state_;
    auto release = [weak, entry, id] {
      entry->live.store(false, std::memory_order_release);
      Subscription removed;
      if (auto state = weak.lock()) {
        std::lock_guard<std::mutex> g(state->m);
        auto it = state->subscriptions.find(id);
        if (it == state->subscriptions.end()) return;
        removed = std::move(it->second);
        state->subscriptions.erase(it);
      }
    };

    std::shared_ptr<Resource> handle =
        Resource::open(String::fromLatin1("App delegate subscription"), std::move(release), nullptr, scope);
    if (!handle->isOpen()) return handle;

    std::vector<P> kept;
    {
      std::lock_guard<std::mutex> g(state_->m);
      if (!entry->live.load(std::memory_order_acquire)) return handle;
      state_->subscriptions.emplace(id, Subscription{entry, handle});
      kept.swap(state_->kept);
    }

    // What launched the app, for its first subscriber: heard where reports are.
    if (!kept.empty())
      postToMain([entry, kept = std::move(kept)] {
        for (const P& payload : kept) call(*entry, payload);
      });
    return handle;
  }

  /// Runs the listeners with `payload`, on the main thread, and gives their
  /// answers in subscription order (those that threw left out). With none,
  /// a kept event waits for the first subscriber.
  Answers report(const P& payload) {
    if (!onMainThread()) throw std::logic_error("DelegateEvent::report is called on the main thread");

    std::vector<std::shared_ptr<Entry>> listeners;
    {
      std::lock_guard<std::mutex> g(state_->m);
      for (const auto& [id, s] : state_->subscriptions) listeners.push_back(s.entry);
      if (listeners.empty() && state_->keep) state_->kept.push_back(payload);
    }

    if constexpr (std::is_void_v<A>) {
      for (const auto& l : listeners)
        if (l->live.load(std::memory_order_acquire)) call(*l, payload);
    } else {
      std::vector<A> answers;
      for (const auto& l : listeners) {
        if (!l->live.load(std::memory_order_acquire)) continue;
        if (auto a = call(*l, payload)) answers.push_back(std::move(*a));
      }
      return answers;
    }
  }

  /// Open subscriptions (for tests).
  size_t subscriptions() const {
    std::lock_guard<std::mutex> g(state_->m);
    return state_->subscriptions.size();
  }

  /// Reports waiting for a first subscriber (for tests).
  size_t kept() const {
    std::lock_guard<std::mutex> g(state_->m);
    return state_->kept.size();
  }

 private:
  struct Entry {
    Listener listener;
    std::atomic<bool> live{true};
  };
  struct Subscription {
    std::shared_ptr<Entry> entry;
    std::shared_ptr<Resource> handle;
  };
  struct State {
    mutable std::mutex m;
    bool keep = false;
    uint64_t next = 1;
    std::map<uint64_t, Subscription> subscriptions;
    std::vector<P> kept;
  };

  /// One listener's answer, or none if it threw.
  static auto call(Entry& e, const P& payload) {
    if constexpr (std::is_void_v<A>) {
      try {
        e.listener(payload);
      } catch (...) {
        reportUncaught(std::current_exception(), "app delegate listener");
      }
    } else {
      try {
        return std::optional<A>(e.listener(payload));
      } catch (...) {
        reportUncaught(std::current_exception(), "app delegate listener");
        return std::optional<A>();
      }
    }
  }

  const std::shared_ptr<State> state_;
};

}  // namespace lucent
