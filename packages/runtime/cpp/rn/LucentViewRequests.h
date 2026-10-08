// Lucent runtime — answers to the commands of Lucent components that return
// a value: requests, settled in the JavaScript runtime that sent them.
//
// A component's proxy hands the views runtime's settle function to the
// Lucent module once (its __lucentViewRequests property, connectRequests
// below), which gives it the base of its request ids: its runtime's id
// times kRequestsPerRuntime. It numbers each request from there, so an id
// names the runtime that sent it, and two runtimes at once (two React
// Native instances) each get their own answers. A host view answers
// through a Requester from any thread; the answer runs on its runtime's
// JavaScript thread, or not at all once that runtime is torn down (a
// reload).
#pragma once

#include <jsi/jsi.h>
#include <lucent/scope.h>

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

  /// The runtime connected last: a command's, for request ids without a
  /// runtime's base. Empty when no runtime has connected (its answers are
  /// dropped).
  static Requester current();

  /// Where request `id` is answered: its runtime's, for an id with a
  /// runtime's base (empty if that runtime is gone), else this one.
  Requester forRequest(double id) const;

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

/// How many request ids each runtime has: its ids start at its id times this.
inline constexpr double kRequestsPerRuntime = 4294967296.0;

/// The first request id of runtime `runtime`.
double requestBase(RuntimeId runtime);

/// Makes `host`'s runtime one requests come from (and the current one),
/// settled through `settle(id, error, value)`, and gives the base its
/// request ids start from. On the JavaScript thread.
double connectRequests(const std::shared_ptr<js::Host>& host, facebook::jsi::Runtime& runtime, facebook::jsi::Function settle);

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
