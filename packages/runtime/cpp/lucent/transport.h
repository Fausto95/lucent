// Lucent runtime — the values a compute task receives.
//
// A task runs on another thread, so it shares nothing mutable with the code
// that submitted it: its input is copied, at submission, into a graph only
// the task holds. Every array, map, set, dictionary, byte buffer, date and
// object reachable from the input is copied once, so two references to one
// object are two references to one copy, and cycles survive. Strings are
// immutable, so they cross as they are. The copy is the whole transport:
// the task runs in the same process, so there is no wire format to unpack.
//
// A type crosses if it has a Transport. The runtime's value types have one;
// the compiler emits one for each struct and class (with transportObject).
// Anything else (functions, promises, signals, native instances) does not
// compile. An object whose class is a subclass of the one its type names is
// refused when copied, with a DataCloneError: its copy would lose fields.
//
// A transport may move instead of copying, for something that must have one
// owner at a time (an owned native buffer): it hands the task the thing
// itself and registers the move with the graph (CopyGraph::onCommit). Moves
// commit only once the whole input has been copied, and roll back if the
// copy fails, so a refused submission leaves the caller's values as they
// were.
#pragma once

#include <any>
#include <cstdint>
#include <functional>
#include <memory>
#include <tuple>
#include <type_traits>
#include <typeinfo>
#include <unordered_map>
#include <utility>
#include <variant>
#include <vector>

#include "array.h"
#include "bigint.h"
#include "bytes.h"
#include "core.h"
#include "date.h"
#include "jserror.h"
#include "jsstring.h"
#include "map.h"
#include "trace.h"

namespace lucent {

/// What a copy refuses to copy: a DataCloneError, as structuredClone throws.
[[noreturn]] void throwDataCloneError(const char* message);

/// One input's copy in progress: the copies made so far, by the identity of
/// what they copy, and the moves to commit once it is complete.
class CopyGraph {
 public:
  CopyGraph() = default;
  CopyGraph(const CopyGraph&) = delete;
  CopyGraph& operator=(const CopyGraph&) = delete;

  /// The copy already made of the object `identity` names, if any.
  template <class H>
  const H* find(const void* identity) const {
    auto it = copies_.find(identity);
    if (it == copies_.end()) return nullptr;

    const H* copy = std::any_cast<H>(&it->second);
    if (!copy) throwDataCloneError("An object reached as two different types cannot be copied");

    return copy;
  }

  /// Records `copy` as the copy of `identity`: before copying what the
  /// object holds, so a cycle leads back to the copy.
  template <class H>
  void remember(const void* identity, const H& copy) {
    copies_.emplace(identity, std::any(copy));
  }

  /// For a transport that moves: `commit` runs once the whole input has
  /// been copied, `rollback` (if any) instead if the copy fails. Each runs
  /// on the submitting thread, in the order registered.
  void onCommit(std::function<void()> commit, std::function<void()> rollback = nullptr) {
    moves_.push_back({std::move(commit), std::move(rollback)});
  }

  /// Objects copied (or moved) so far.
  size_t copied() const { return copies_.size(); }

  /// Bytes of element storage copied so far (arrays, byte buffers): what
  /// a trace reports for the copy.
  size_t bytes() const { return bytes_; }
  void countBytes(size_t n) { bytes_ += n; }

  /// Runs the commits (or, if `failed`, the rollbacks) and forgets them.
  void finish(bool failed) {
    auto moves = std::move(moves_);
    moves_.clear();

    for (auto& [commit, rollback] : moves) {
      if (!failed) {
        commit();
      } else if (rollback) {
        rollback();
      }
    }
  }

 private:
  std::unordered_map<const void*, std::any> copies_;
  std::vector<std::pair<std::function<void()>, std::function<void()>>> moves_;
  size_t bytes_ = 0;
};

/// How a `T` crosses to a task: `static T copy(const T&, CopyGraph&)`.
/// Specialized for the runtime's value types here and, by the compiler, for
/// each struct and class. Unspecialized, the type cannot cross.
template <class T>
struct Transport {};

template <class T>
concept Transportable = requires(const T& value, CopyGraph& graph) {
  { Transport<T>::copy(value, graph) } -> std::same_as<T>;
};

/// Copies one part of an input: what a Transport calls for what it holds.
template <class T>
T transport(const T& value, CopyGraph& graph) {
  static_assert(Transportable<T>, "This type cannot cross to a compute task: it has no lucent::Transport");

  return Transport<T>::copy(value, graph);
}

/// Copies `value` for a task, committing the moves it registered; if the
/// copy throws, they roll back and the error reaches the caller.
template <class T>
T transportCopy(const T& value) {
  CopyGraph graph;
  trace::Mark mark = trace::begin(trace::Category::Copy, "transport.copy");

  try {
    T copy = transport(value, graph);
    graph.finish(false);

    trace::end(mark, trace::Category::Copy, "transport.copy",
               {.parent = trace::currentId(), .value = static_cast<int64_t>(graph.bytes()), .count = static_cast<int64_t>(graph.copied())});
    return copy;
  } catch (...) {
    graph.finish(true);
    trace::end(mark, trace::Category::Copy, "transport.copy", {.parent = trace::currentId(), .count = -1});
    throw;
  }
}

/// A Transport for a struct or class `T` (the compiler emits one per type):
/// refuses an object of a subclass, makes one copy per object, remembers it
/// before `fields(from, to, graph)` copies what it holds. `T` must be
/// default-constructible.
template <class T, class Fields>
Ref<T> transportObject(const Ref<T>& source, CopyGraph& graph, Fields&& fields) {
  if (!source) return source;

  // Most derived: the same object reached through any base is one.
  const void* identity = dynamic_cast<const void*>(source.get());
  if (auto* copy = graph.find<Ref<T>>(identity)) return *copy;

  if (typeid(*source) != typeid(T)) throwDataCloneError("An object of a subclass cannot be copied as its base class");

  auto copy = std::make_shared<T>();
  graph.remember(identity, copy);

  fields(*source, *copy, graph);
  return copy;
}

// --- the runtime's values -----------------------------------------------------

namespace detail {

/// Values that cross as they are: plain data, and immutable strings and
/// bigints.
template <class T>
concept CrossesAsIs = std::is_arithmetic_v<T> || std::is_enum_v<T> || std::is_same_v<T, String> ||
                      std::is_same_v<T, BigInt> || std::is_same_v<T, Undefined> || std::is_same_v<T, Null>;

}  // namespace detail

template <class T>
  requires detail::CrossesAsIs<T>
struct Transport<T> {
  static T copy(const T& value, CopyGraph&) { return value; }
};

template <Transportable T>
struct Transport<Opt<T>> {
  static Opt<T> copy(const Opt<T>& value, CopyGraph& graph) {
    if (value.has()) return Opt<T>(transport(value.get(), graph));

    return value;
  }
};

template <Transportable... Ts>
struct Transport<std::variant<Ts...>> {
  using V = std::variant<Ts...>;

  static V copy(const V& value, CopyGraph& graph) { return copyAt<0>(value, graph); }

  /// By index, not type: an alternative's type may repeat.
  template <size_t I>
  static V copyAt(const V& value, CopyGraph& graph) {
    if constexpr (I + 1 < sizeof...(Ts)) {
      if (value.index() != I) return copyAt<I + 1>(value, graph);
    }

    return V(std::in_place_index<I>, transport(*std::get_if<I>(&value), graph));
  }
};

template <Transportable... Ts>
struct Transport<std::tuple<Ts...>> {
  static std::tuple<Ts...> copy(const std::tuple<Ts...>& value, CopyGraph& graph) {
    // Braced: the parts are copied in order.
    return std::apply([&](const Ts&... parts) { return std::tuple<Ts...>{transport(parts, graph)...}; }, value);
  }
};

template <Transportable T>
struct Transport<Array<T>> {
  static Array<T> copy(const Array<T>& source, CopyGraph& graph) {
    if (auto* copy = graph.find<Array<T>>(source.identity())) return *copy;

    Array<T> copy;
    graph.remember(source.identity(), copy);

    if constexpr (detail::CrossesAsIs<T>) {
      copy.items() = source.items();
      graph.countBytes(source.size() * sizeof(typename Array<T>::Elem));
    } else {
      auto& items = copy.items();
      items.reserve(source.size());
      graph.countBytes(source.size() * sizeof(typename Array<T>::Elem));

      for (const auto& item : source.items()) items.push_back(transport(item, graph));
    }

    return copy;
  }
};

template <Transportable K, Transportable V>
struct Transport<Map<K, V>> {
  static Map<K, V> copy(const Map<K, V>& source, CopyGraph& graph) {
    if (auto* copy = graph.find<Map<K, V>>(source.identity())) return *copy;

    Map<K, V> copy;
    graph.remember(source.identity(), copy);

    auto& table = source.table();
    for (size_t i = 0; i < table.slotCount(); i++) {
      if (!table.slotLive(i)) continue;

      const auto& entry = table.slot(i);
      copy.set(transport(entry.key, graph), transport(entry.value, graph));
    }

    return copy;
  }
};

template <Transportable T>
struct Transport<Set<T>> {
  static Set<T> copy(const Set<T>& source, CopyGraph& graph) {
    if (auto* copy = graph.find<Set<T>>(source.identity())) return *copy;

    Set<T> copy;
    graph.remember(source.identity(), copy);

    auto& table = source.table();
    for (size_t i = 0; i < table.slotCount(); i++) {
      if (table.slotLive(i)) copy.add(transport(table.slot(i).key, graph));
    }

    return copy;
  }
};

template <Transportable V>
struct Transport<Dict<V>> {
  static Dict<V> copy(const Dict<V>& source, CopyGraph& graph) {
    if (auto* copy = graph.find<Dict<V>>(source.identity())) return *copy;

    Dict<V> copy;
    graph.remember(source.identity(), copy);

    auto& table = source.table();
    for (size_t i = 0; i < table.slotCount(); i++) {
      if (!table.slotLive(i)) continue;

      const auto& entry = table.slot(i);
      copy.set(entry.key, transport(entry.value, graph));
    }

    return copy;
  }
};

/// Views of one buffer stay views of one (copied) buffer, as
/// structuredClone keeps them: a view carries its whole buffer, so slice()
/// a small view of a large buffer before submitting it.
template <>
struct Transport<Bytes> {
  using Buffer = std::shared_ptr<std::vector<uint8_t>>;

  static Bytes copy(const Bytes& source, CopyGraph& graph) {
    const Buffer& buffer = source.buffer();

    const Buffer* copied = graph.find<Buffer>(buffer.get());
    if (!copied) {
      graph.remember(buffer.get(), std::make_shared<std::vector<uint8_t>>(*buffer));
      graph.countBytes(buffer->size());
      copied = graph.find<Buffer>(buffer.get());
    }

    return Bytes::view(*copied, source.offset(), source.size());
  }
};

template <>
struct Transport<Date> {
  static Date copy(const Date& source, CopyGraph& graph) {
    if (!source) return source;

    if (auto* copy = graph.find<Date>(source.get())) return *copy;

    Date copy = makeDate(source->getTime());
    graph.remember(source.get(), copy);
    return copy;
  }
};

}  // namespace lucent
