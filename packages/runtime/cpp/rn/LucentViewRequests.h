// Lucent runtime — answers to the commands of Lucent components that return
// a value: requests, settled in the JavaScript runtime that sent them.
//
// A component's proxy numbers each request and hands the views runtime's
// settle function to the Lucent module once (its __lucentViewRequests
// property, connectRequests below). A host view captures the Requester
// current when a command arrives, and answers through it from any thread.
// The answer runs on that runtime's JavaScript thread, or not at all once
// that runtime is torn down (a reload): request ids start again in each
// runtime, so an answer never reaches another one.
#pragma once

#include <jsi/jsi.h>

#include <cstdint>
#include <functional>
#include <memory>
#include <optional>
#include <string>
#include <utility>

namespace lucent::js {
class Host;
}

namespace lucent::views {

/// A request's answer, built on the JavaScript thread.
using AnswerValue = std::function<facebook::jsi::Value(facebook::jsi::Runtime&)>;

/** The runtime a request came from. Copyable; any thread. */
class Requester {
 public:
  Requester() = default;

  /// The runtime connected now: a command's, when it arrives. Empty when no
  /// runtime has connected (its answers are dropped).
  static Requester current();

  /// Settles request `id` with `value`. Dropped when the runtime is gone.
  void resolve(double id, AnswerValue value) const;

  /// Rejects request `id` with an Error whose message is `message`.
  void reject(double id, std::string message) const;

  /// Whether its runtime is still there (not torn down).
  explicit operator bool() const;

 private:
  Requester(std::weak_ptr<js::Host> host, uint64_t settle) : host_(std::move(host)), settle_(settle) {}

  void settle(double id, std::function<void(facebook::jsi::Runtime&, facebook::jsi::Function&)> call) const;

  std::weak_ptr<js::Host> host_;
  /// The settle function, retained by the host.
  uint64_t settle_ = 0;
};

/// Makes `host`'s runtime the one requests come from, settled through
/// `settle(id, error, value)`. On the JavaScript thread.
void connectRequests(const std::shared_ptr<js::Host>& host, facebook::jsi::Runtime& runtime, facebook::jsi::Function settle);

/// The name the Lucent module gives the function JavaScript connects with.
inline constexpr const char* kRequestsName = "__lucentViewRequests";

/**
 * A request command's answer. The host settles JavaScript's promise with it
 * on the JS thread (`settle(request, error, value)`): rejected with an
 * Error of `error`'s message when set, else resolved with `value()`.
 */
struct Answer {
  double request{0};
  std::optional<std::string> error{};
  AnswerValue value{};
};

/**
 * Where a mount sends its answers. A mount answers each request once:
 * with its result or error, or, still unanswered when the mount ends,
 * with a rejection then.
 */
using Respond = std::function<void(Answer)>;

/**
 * A mount's answers, to `requester`'s runtime while `host` (the platform's
 * HostView: `current()`, whether its view still holds that mount) says so.
 * Once the view holds another mount, or none (recycled, remounted: a view
 * or a tag reused), an answer is dropped with what it carries: JavaScript
 * rejected the request when React unmounted its view. On the thread the
 * host reads its view on (the main thread).
 */
template <class Host>
Respond answerTo(Host host, Requester requester) {
  return [host = std::move(host), requester = std::move(requester)](Answer answer) {
    if (!host.current()) return;

    if (answer.error)
      requester.reject(answer.request, std::move(*answer.error));
    else
      requester.resolve(answer.request, std::move(answer.value));
  };
}

}  // namespace lucent::views
