// Lucent runtime — what the glue of SwiftUI components shares (iOS,
// Objective-C++ with ARC).
//
// A SwiftUI component's body is Swift, generated from the function its
// setup gives swiftUI(); the rest of the setup is Lucent code. The
// generated Swift calls back into it through C functions: the body's
// actions (the setup's functions a tap… calls) by index, with the
// arguments the Swift gives them, the Lucent code `withAnimation`
// animates, and a change of the body's size. All run on the main thread;
// actions and animations in Lucent's main context.
#pragma once

#import <Foundation/Foundation.h>

#include <cstddef>
#include <cstdint>
#include <exception>
#include <functional>
#include <initializer_list>
#include <memory>
#include <type_traits>
#include <utility>
#include <vector>

#include "../array.h"
#include "../function.h"
#include "../items.h"
#include "../native.h"
#include "../view.h"
#include "ios.h"

namespace lucent::swiftui {

/// How the Swift side runs action `action` of `context`, with `args`: a
/// retained NSArray of its arguments, which the call takes.
using Invoke = void (*)(void* context, int32_t action, void* args);
/// How it lets `context` go, when its view goes.
using Release = void (*)(void* context);
/// How it reports that the body's size changed.
using Resized = void (*)(void* context);
/// The Lucent code withAnimation runs.
using Body = void (*)(void* context);

/**
 * The actions a body calls, by index, and the content of their mount. The
 * Swift side holds them through a context (context()) until its view
 * goes; the mount clears them when it ends, so what they captured goes
 * with it.
 */
struct Actions {
  explicit Actions(std::weak_ptr<ui::Content> content) : content(std::move(content)) {}

  std::vector<std::function<void(NSArray* args)>> list;
  /// The mount's content, which a change of the body's size marks.
  std::weak_ptr<ui::Content> content;
};

/// A context the Swift side owns (release() lets it go), holding `actions`.
inline void* context(const std::shared_ptr<Actions>& actions) {
  return new std::shared_ptr<Actions>(actions);
}

/// Runs an action, which Swift calls on the main thread, in the main context.
inline void invoke(void* context, int32_t action, void* args) {
  NSArray* given = (__bridge_transfer NSArray*)args;
  auto actions = *static_cast<std::shared_ptr<Actions>*>(context);

  if (action < 0 || static_cast<std::size_t>(action) >= actions->list.size()) return;

  // A copy: the action may end the mount, which clears the list.
  auto run = actions->list[static_cast<std::size_t>(action)];

  if (run) callNowIn(ExecutionContext::main(), [&] { run(given); });
}

namespace detail {

/// An action's argument `i`, as the Lucent function takes it; missing, or NSNull, is none.
template <class T>
struct Arg;

template <>
struct Arg<double> {
  static double from(id v) { return [(NSNumber*)v doubleValue]; }
};

template <>
struct Arg<bool> {
  static bool from(id v) { return [(NSNumber*)v boolValue]; }
};

template <>
struct Arg<String> {
  static String from(id v) { return objc::fromNSString((NSString*)v, "a SwiftUI argument"); }
};

template <class T>
struct Arg<Opt<T>> {
  static Opt<T> from(id v) { return v && v != [NSNull null] ? Opt<T>(Arg<T>::from(v)) : Opt<T>(null); }
};

template <class T>
T arg(NSArray* args, std::size_t i) {
  return Arg<T>::from(i < args.count ? args[i] : nil);
}

template <class... A, std::size_t... I>
void call(const Fn<void(A...)>& f, NSArray* args, std::index_sequence<I...>) {
  f(arg<A>(args, I)...);
}

}  // namespace detail

/// The setup function `f` as an action: the Swift side's arguments, in order, are its parameters.
template <class... A>
std::function<void(NSArray*)> action(Fn<void(A...)> f) {
  return [f = std::move(f)](NSArray* args) { detail::call(f, args, std::index_sequence_for<A...>{}); };
}

inline void release(void* context) { delete static_cast<std::shared_ptr<Actions>*>(context); }

/**
 * The body's size changed, SwiftUI's own layout too (no Lucent code ran):
 * its mount's content is marked, so the host measures it again on a later
 * turn of the main thread. Swift calls it on the main thread.
 */
inline void resized(void* context) {
  ui::invalidateSize((*static_cast<std::shared_ptr<Actions>*>(context))->content);
}

// --- plain data, encoded for the Swift side (emit/toolkit-values.ts) ----------------------

inline id value(double v) { return @(v); }
inline id value(bool v) { return @(v); }
inline id value(const String& v) { return objc::toNSString(v); }

/// NSNull when `v` is null or undefined, else `each` of its value.
template <class T, class F>
id optional(const Opt<T>& v, F each) {
  return v.has() ? each(v.get()) : [NSNull null];
}

template <class T, class F>
id array(const Array<T>& a, F each) {
  NSMutableArray* out = [NSMutableArray arrayWithCapacity:a.size()];

  for (std::size_t i = 0; i < a.size(); i++) [out addObject:each(a.at(i))];

  return out;
}

/// An object's fields, in order.
inline id record(std::initializer_list<id> fields) {
  return [NSArray arrayWithObjects:fields.begin() count:fields.size()];
}

/// A retained object the Swift side returns (a hosting controller), as Lucent's reference.
inline NativeRef adopt(void* retained, const char* what) {
  return objc::wrap((__bridge_transfer id)retained, what);
}

/**
 * withAnimation: `shim` runs SwiftUI's withAnimation around a call of
 * `body`, now, with the animation's Lucent values (`args`, as its C
 * types). Its writes are one transaction, whose effects (the values the
 * body shows) run before withAnimation returns, so SwiftUI animates what
 * they change. What `body` throws is thrown here, once Swift is done.
 */
template <class F, class... A>
void animate(void (*shim)(void* context, Body body, A...), F body, std::type_identity_t<A>... args) {
  struct Call {
    F* body;
    std::exception_ptr error;
  } call{&body, nullptr};

  shim(&call, [](void* context) {
    auto* c = static_cast<Call*>(context);

    // Nothing may unwind through Swift's frames.
    try {
      ui::mainGraph()->transaction([&] { (*c->body)(); });
    } catch (...) {
      c->error = std::current_exception();
    }
  }, args...);

  if (call.error) std::rethrow_exception(call.error);
}

}  // namespace lucent::swiftui
