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

#include <cstdint>
#include <memory>
#include <string>
#include <tuple>
#include <type_traits>
#include <variant>
#include <vector>

#include "array.h"
#include "core.h"
#include "map.h"

namespace lucent::debug {

/// What an object reports its strong references to.
class RefSink {
 public:
  /// A strong reference to `to` held by the field `name` ("Session.onFrame"),
  /// declared at `where` ("camera.lucent.ts:12", or empty).
  virtual void edge(const Object* to, const char* name, const char* where) = 0;

 protected:
  ~RefSink() = default;
};

/// Lists every object made from now on, for cycles(). For debug hosts, at
/// their start; it stays on.
void trackObjects();

/// Whether objects are being listed.
bool tracksObjects();

/// One step of a cycle: the field that refers to the next object.
struct CycleStep {
  std::string field;
  std::string where;
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
}  // namespace detail

/// Plain data, strings, functions (their captures are not reported yet):
/// nothing.
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

}  // namespace lucent::debug
