// Lucent runtime — reference cycles, as a debug build reports them (TA41).
//
// Objects are reference counted, so a cycle of strong references keeps its
// objects alive for good. A debug host lists every object as it is made
// (trackObjects); each generated class and struct reports its strong
// references, field by field (Object::lucentRefs_, which the compiler
// emits); cycles() walks the objects alive now and finds the cycles among
// them, each as the path of fields that closes it, from its oldest object
// back to it. The last step of that path is the one to hold through a
// WeakRef: the reference back to what came first.
//
// The walk takes a strong reference to each object while it reads them,
// and reads their fields as they are: a report is a snapshot, meant for a
// moment no code is changing them (a teardown, a test).
#pragma once

#include <algorithm>
#include <cstdint>
#include <memory>
#include <string>
#include <tuple>
#include <type_traits>
#include <variant>
#include <vector>

#include "array.h"
#include "core.h"
#include "function.h"
#include "map.h"

namespace lucent::debug {

/// What an object reports its strong references to.
class RefSink {
 public:
  /// A strong reference to `to` held by the field `name` ("Session.onFrame"),
  /// declared at `where` ("camera.lucent.ts:12", or empty); through a
  /// closure the field holds, made at `closure`, which captures `capture`
  /// ("this"), when those are given.
  virtual void edge(const Object* to, const char* name, const char* where, const char* closure = nullptr,
                    const char* capture = nullptr) = 0;

 protected:
  ~RefSink() = default;
};

/// Lists every object made from now on, for cycles(). For debug hosts, at
/// their start; it stays on.
void trackObjects();

/// Whether objects are being listed.
bool tracksObjects();

/// One step of a cycle: the field that refers to the next object, maybe
/// through a closure it holds and what that closure captures.
struct CycleStep {
  std::string field;
  std::string where;
  std::string closure;
  std::string capture;
};

/// A cycle of strong references: its objects, and the fields from the
/// oldest object around to it again.
struct Cycle {
  size_t objects = 0;
  std::vector<CycleStep> steps;
};

/// The cycles among the objects alive now, one per group of objects that
/// keep each other alive; `fresh` leaves out those an earlier call found.
std::vector<Cycle> cycles(bool fresh = false);

/// A cycle as a debug build logs it: "a reference cycle keeps 2 objects
/// alive: Parent.child (tree.lucent.ts:3), then Child.parent
/// (tree.lucent.ts:9), back to the first. Hold Child.parent through a
/// WeakRef to break it."
std::string describe(const Cycle& cycle);

/// Keeps a cycle's description, as a teardown logs it, for JavaScript to
/// show: a debug host's next runtime takes it (`__lucentDebug.cycles()`,
/// which the loader writes to the console, so LogBox shows it once), and
/// every snapshot lists it.
void keepReport(std::string report);

/// The descriptions kept since the last call, which it forgets.
std::vector<std::string> takeReports();

/// Every description kept since the process started.
std::vector<std::string> reports();

// --- what generated code calls: a field's references ----------------------------

template <class T>
void refs(RefSink& sink, const T& value, const char* name, const char* where);
template <class T>
void refs(RefSink& sink, const std::shared_ptr<T>& value, const char* name, const char* where);
template <class T>
void refs(RefSink& sink, const Opt<T>& value, const char* name, const char* where);
template <class T>
void refs(RefSink& sink, const Array<T>& value, const char* name, const char* where);
template <class K, class V>
void refs(RefSink& sink, const Map<K, V>& value, const char* name, const char* where);
template <class T>
void refs(RefSink& sink, const Set<T>& value, const char* name, const char* where);
template <class V>
void refs(RefSink& sink, const Dict<V>& value, const char* name, const char* where);
template <class... Ts>
void refs(RefSink& sink, const std::tuple<Ts...>& value, const char* name, const char* where);
template <class... Ts>
void refs(RefSink& sink, const std::variant<Ts...>& value, const char* name, const char* where);
template <class Sig>
void refs(RefSink& sink, const Fn<Sig>& value, const char* name, const char* where);
template <class T>
void refs(RefSink& sink, const Box<T>& value, const char* name, const char* where);

namespace detail {
/// The object a reference refers to: an interface value's is its class instance.
template <class T>
const Object* objectOf(const T* p) {
  if constexpr (std::is_base_of_v<Object, T>) {
    return static_cast<const Object*>(p);
  } else if constexpr (std::is_polymorphic_v<T>) {
    return dynamic_cast<const Object*>(p);
  } else {
    return nullptr;
  }
}

/// Whether a value of `T` can hold a strong reference to an object.
template <class T>
inline constexpr bool mayRefer = !std::is_arithmetic_v<T> && !std::is_enum_v<T> && !std::is_same_v<T, String>;

/// The closures this thread's walk is inside: one that captures itself
/// (through a box) is read once. In refs.cpp: a header's thread-local of a
/// vector would get an initialization routine in every unit that uses it,
/// which Apple's linker refuses as duplicates.
std::vector<const void*>& closuresInWalk();

/// What a closure's captures report, reached through a field: each edge
/// names the field, the closure and the capture.
class Through final : public RefSink {
 public:
  Through(RefSink& outer, const char* field, const char* where, const char* closure)
      : outer_(outer), field_(field), where_(where), closure_(closure) {}

  void edge(const Object* to, const char* name, const char* where, const char* closure,
            const char* capture) override {
    if (!closure) {
      outer_.edge(to, field_, where_, closure_, name);
      return;
    }
    // A closure this one captures, which captures `capture`.
    std::string through = std::string(field_) + (*where_ ? std::string(" (") + where_ + ")" : std::string()) +
                          ", then the closure at " + closure_ + ", which captures " + name;
    outer_.edge(to, through.c_str(), "", closure, capture);
  }

 private:
  RefSink& outer_;
  const char* field_;
  const char* where_;
  const char* closure_;
};
}  // namespace detail

/// Plain data and strings: nothing.
template <class T>
void refs(RefSink&, const T&, const char*, const char*) {}

template <class T>
void refs(RefSink& sink, const std::shared_ptr<T>& value, const char* name, const char* where) {
  if (!value) return;
  if (const Object* o = detail::objectOf(value.get())) sink.edge(o, name, where);
}

template <class T>
void refs(RefSink& sink, const Opt<T>& value, const char* name, const char* where) {
  if (value.has()) refs(sink, value.get(), name, where);
}

template <class T>
void refs(RefSink& sink, const Array<T>& value, const char* name, const char* where) {
  if constexpr (detail::mayRefer<T>)
    for (const auto& v : value.items()) refs(sink, v, name, where);
}

template <class K, class V>
void refs(RefSink& sink, const Map<K, V>& value, const char* name, const char* where) {
  if constexpr (detail::mayRefer<K> || detail::mayRefer<V>)
    value.forEach([&](const V& v, const K& k) {
      refs(sink, k, name, where);
      refs(sink, v, name, where);
    });
}

template <class T>
void refs(RefSink& sink, const Set<T>& value, const char* name, const char* where) {
  if constexpr (detail::mayRefer<T>) value.forEach([&](const T& v) { refs(sink, v, name, where); });
}

template <class V>
void refs(RefSink& sink, const Dict<V>& value, const char* name, const char* where) {
  if constexpr (detail::mayRefer<V>)
    for (const auto& v : value.values().items()) refs(sink, v, name, where);
}

template <class... Ts>
void refs(RefSink& sink, const std::tuple<Ts...>& value, const char* name, const char* where) {
  std::apply([&](const auto&... vs) { (refs(sink, vs, name, where), ...); }, value);
}

template <class... Ts>
void refs(RefSink& sink, const std::variant<Ts...>& value, const char* name, const char* where) {
  std::visit([&](const auto& v) { refs(sink, v, name, where); }, value);
}

/// A function value: what its closure captures, once per walk.
template <class Sig>
void refs(RefSink& sink, const Fn<Sig>& value, const char* name, const char* where) {
  auto& inside = detail::closuresInWalk();
  const void* id = value.identity();
  if (!id || std::find(inside.begin(), inside.end(), id) != inside.end()) return;

  inside.push_back(id);
  value.lucentRefs_(sink, name, where);
  inside.pop_back();
}

/// A variable closures share: what it holds now.
template <class T>
void refs(RefSink& sink, const Box<T>& value, const char* name, const char* where) {
  refs(sink, *value, name, where);
}

}  // namespace lucent::debug

namespace lucent {

/// A closure as the compiler makes it, when it captures what may refer to
/// objects: its captures, in a tuple, and `f`, the code, which takes them
/// first (by reference, so a mutable capture keeps its changes; by value
/// for a coroutine, whose frame then owns them). It says what its captures
/// refer to, by the names `names` gives them ("this,listener"), for a debug
/// build's cycle report; it is made at `site` ("camera.lucent.ts:41").
template <class F, class... Caps>
struct Closure {
  F f;
  std::tuple<Caps...> caps;
  const char* site;
  const char* names;

  template <class... A>
  auto operator()(A&&... args) -> decltype(std::declval<F&>()(std::declval<Caps&>()..., std::forward<A>(args)...)) {
    return std::apply([&](Caps&... c) -> decltype(auto) { return f(c..., std::forward<A>(args)...); }, caps);
  }

  void lucentRefs_(debug::RefSink& sink, const char* field, const char* where) const {
    debug::detail::Through through(sink, field, where, site);
    size_t i = 0;
    std::apply([&](const Caps&... c) { (report(through, c, i++), ...); }, caps);
  }

 private:
  template <class C>
  void report(debug::RefSink& through, const C& capture, size_t i) const {
    if constexpr (debug::detail::mayRefer<C>) {
      const std::string name = nameAt(i);
      debug::refs(through, capture, name.c_str(), site);
    }
  }

  std::string nameAt(size_t i) const {
    const char* p = names;
    for (; i > 0 && *p; p++)
      if (*p == ',') i--;
    const char* end = p;
    while (*end && *end != ',') end++;
    return std::string(p, end);
  }
};

/// `Closure{f, captures…}`, made where the compiler makes a closure.
template <class F, class... Caps>
Closure<std::decay_t<F>, std::decay_t<Caps>...> closure(const char* site, const char* names, F&& f, Caps&&... caps) {
  return {std::forward<F>(f), std::tuple<std::decay_t<Caps>...>(std::forward<Caps>(caps)...), site, names};
}

}  // namespace lucent
