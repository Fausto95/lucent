// Lucent runtime — WeakMap and WeakSet.
//
// Keys are objects (class instances, interface values, object values),
// compared by identity, and held weakly: an entry goes with its key's last
// strong reference, at once, its value with it (as a WeakRef's target goes).
// The key knows the tables it is in (Object::keyIn), and its destructor
// drops its entries. There is no iteration, as in JavaScript. A collection
// and its keys belong to one context, like a WeakRef.
//
// A platform object's key (NativeRef) is held through the platform's weak
// reference instead, as is a WeakRef's platform target: the platform frees
// the object, so its entry goes when the table next grows, its value with
// it.
#pragma once

#include <algorithm>
#include <memory>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <utility>
#include <vector>

#include "core.h"
#include "function.h"
#include "jsstring.h"
#include "native.h"
#include "report.h"
#include "scheduler.h"

namespace lucent {

namespace detail {

/// The object a key is: what its identity, and its entries' lifetime, are.
template <class T>
Object* weakKeyOf(const Ref<T>& key) {
  Object* o = nullptr;
  if constexpr (std::is_base_of_v<Object, T>) {
    o = const_cast<Object*>(static_cast<const Object*>(key.get()));
  } else {
    o = dynamic_cast<Object*>(const_cast<std::remove_const_t<T>*>(key.get()));
  }
  if (!o) throwTypeError("Invalid value used as weak collection key");
  return o;
}

}  // namespace detail

/// `WeakMap<K, V>`: a handle, like Map's; copies share the entries.
template <class K, class V>
class WeakMap {
 public:
  WeakMap() : t_(std::make_shared<Table>()) {}

  Opt<V> get(const K& key) const {
    auto it = t_->entries.find(detail::weakKeyOf(key));
    if (it == t_->entries.end()) return undefined;
    return it->second;
  }
  bool has(const K& key) const { return t_->entries.count(detail::weakKeyOf(key)) != 0; }
  WeakMap& set(const K& key, V value) {
    Object* o = detail::weakKeyOf(key);
    auto it = t_->entries.find(o);
    if (it != t_->entries.end()) {
      // The value replaced goes after the entry is written: freeing it may free other keys.
      [[maybe_unused]] V old = std::exchange(it->second, std::move(value));
      return *this;
    }
    t_->entries.emplace(o, std::move(value));
    o->keyIn(t_);
    return *this;
  }
  bool remove(const K& key) {
    auto node = t_->entries.extract(detail::weakKeyOf(key));
    return !node.empty();
  }

  const void* identity() const { return t_.get(); }

 private:
  struct Table : detail::WeakTable {
    std::unordered_map<const Object*, V> entries;

    void drop(const Object* key) noexcept override {
      // Extracted first, freed after: the value may free other keys of this table.
      [[maybe_unused]] auto node = entries.extract(key);
    }
  };

  std::shared_ptr<Table> t_;
};

/// `WeakSet<K>`: a handle; copies share the keys.
template <class K>
class WeakSet {
 public:
  WeakSet() : t_(std::make_shared<Table>()) {}

  bool has(const K& key) const { return t_->keys.count(detail::weakKeyOf(key)) != 0; }
  WeakSet& add(const K& key) {
    Object* o = detail::weakKeyOf(key);
    if (t_->keys.insert(o).second) o->keyIn(t_);
    return *this;
  }
  bool remove(const K& key) { return t_->keys.erase(detail::weakKeyOf(key)) != 0; }

  const void* identity() const { return t_.get(); }

 private:
  struct Table : detail::WeakTable {
    std::unordered_set<const Object*> keys;

    void drop(const Object* key) noexcept override { keys.erase(key); }
  };

  std::shared_ptr<Table> t_;
};

/// `WeakRef<T>` of a platform object: the platform's weak reference, so
/// deref() gives the object while anything holds it, Lucent or the platform.
template <>
struct WeakRefObject<NativeRef> : Object {
  explicit WeakRefObject(const NativeRef& target) : target_(target.weak()) {}

  Opt<NativeRef> deref() const {
    if (NativeRef strong = target_.lock()) return Opt<NativeRef>(std::move(strong));
    return Opt<NativeRef>(undefined);
  }

 private:
  NativeWeak target_;
};

namespace detail {

/// The entries of a weak collection keyed by platform objects, by the hash
/// of their identity: an entry holds its key weakly, and goes once the
/// platform has freed the key, at the next sweep, which runs when the
/// table has doubled since the last.
template <class Entry>
struct NativeKeys {
  std::unordered_multimap<std::size_t, Entry> entries;
  std::size_t sweepAt = 8;

  Entry* find(const NativeRef& key) {
    if (!key) throwTypeError("Invalid value used as weak collection key");
    auto [it, end] = entries.equal_range(key.identityHash());
    for (; it != end; ++it) {
      NativeRef held = it->second.key.lock();
      if (held && held.same(key)) return &it->second;
    }
    return nullptr;
  }

  void add(const NativeRef& key, Entry entry) {
    sweep();
    entries.emplace(key.identityHash(), std::move(entry));
  }

  bool remove(const NativeRef& key) {
    Entry* e = find(key);
    if (!e) return false;
    auto [it, end] = entries.equal_range(key.identityHash());
    for (; it != end; ++it)
      if (&it->second == e) break;
    // Extracted first, freed after: the value may free other keys of this table.
    [[maybe_unused]] auto node = entries.extract(it);
    return true;
  }

  void sweep() {
    if (entries.size() < sweepAt) return;
    std::vector<typename decltype(entries)::node_type> gone;
    for (auto it = entries.begin(); it != entries.end();) {
      auto next = std::next(it);
      if (!it->second.key.lock()) gone.push_back(entries.extract(it));
      it = next;
    }
    sweepAt = std::max<std::size_t>(8, entries.size() * 2);
  }
};

}  // namespace detail

/// `WeakMap<K, V>` keyed by platform objects.
template <class V>
class WeakMap<NativeRef, V> {
 public:
  WeakMap() : t_(std::make_shared<detail::NativeKeys<Entry>>()) {}

  Opt<V> get(const NativeRef& key) const {
    Entry* e = t_->find(key);
    if (!e) return undefined;
    return e->value;
  }
  bool has(const NativeRef& key) const { return t_->find(key) != nullptr; }
  WeakMap& set(const NativeRef& key, V value) {
    if (Entry* e = t_->find(key)) {
      // The value replaced goes after the entry is written: freeing it may free other keys.
      [[maybe_unused]] V old = std::exchange(e->value, std::move(value));
      return *this;
    }
    t_->add(key, Entry{key.weak(), std::move(value)});
    return *this;
  }
  bool remove(const NativeRef& key) { return t_->remove(key); }

  const void* identity() const { return t_.get(); }

 private:
  struct Entry {
    NativeWeak key;
    V value;
  };

  std::shared_ptr<detail::NativeKeys<Entry>> t_;
};

/// `WeakSet<K>` of platform objects.
template <>
class WeakSet<NativeRef> {
 public:
  WeakSet() : t_(std::make_shared<detail::NativeKeys<Entry>>()) {}

  bool has(const NativeRef& key) const { return t_->find(key) != nullptr; }
  WeakSet& add(const NativeRef& key) {
    if (!t_->find(key)) t_->add(key, Entry{key.weak()});
    return *this;
  }
  bool remove(const NativeRef& key) { return t_->remove(key); }

  const void* identity() const { return t_.get(); }

 private:
  struct Entry {
    NativeWeak key;
  };

  std::shared_ptr<detail::NativeKeys<Entry>> t_;
};

/**
 * `FinalizationRegistry<H>`: a handle, like Map's. Each registration keeps
 * its held value until its target's last strong reference goes; then the
 * cleanup runs with it, as a job of the context that made the registry,
 * after the turn that freed the target (as JavaScript's cleanups run after
 * the job that collected). A registration a token removed, or one of a
 * registry gone first, never runs. What a cleanup throws is reported.
 */
template <class H>
class FinalizationRegistry {
 public:
  explicit FinalizationRegistry(Fn<void(H)> cleanup) : t_(std::make_shared<Table>(std::move(cleanup))) {}
  /// A module variable's before its initializer runs: no cleanup.
  FinalizationRegistry() : FinalizationRegistry(Fn<void(H)>([](H) {})) {}

  /// `register(target, held, token)`: TypeError when the target is its own held value.
  template <class T>
  void registerTarget(const Ref<T>& target, H held) {
    add(target, std::move(held), std::weak_ptr<void>(), false);
  }
  template <class T, class K>
  void registerTarget(const Ref<T>& target, H held, const Ref<K>& token) {
    add(target, std::move(held), std::weak_ptr<void>(token), true);
  }
  template <class T, class K>
  void registerTarget(const Ref<T>& target, H held, const Opt<Ref<K>>& token) {
    if (token.has()) registerTarget(target, std::move(held), token.get());
    else registerTarget(target, std::move(held));
  }

  /// Removes the registrations made with `token`; whether there were any.
  template <class K>
  bool unregister(const Ref<K>& token) {
    std::weak_ptr<void> t(token);
    bool removed = false;
    for (auto it = t_->entries.begin(); it != t_->entries.end();) {
      removed |= std::erase_if(it->second, [&](const Entry& e) {
                   return e.tokened && !e.token.owner_before(t) && !t.owner_before(e.token);
                 }) > 0;
      it = it->second.empty() ? t_->entries.erase(it) : std::next(it);
    }
    return removed;
  }

  const void* identity() const { return t_.get(); }

 private:
  struct Entry {
    H held;
    std::weak_ptr<void> token;
    bool tokened;
  };

  struct Table : detail::WeakTable, std::enable_shared_from_this<Table> {
    explicit Table(Fn<void(H)> f) : cleanup(std::move(f)) {}

    Fn<void(H)> cleanup;
    ExecutionContext& context = ExecutionContext::current() ? *ExecutionContext::current() : Actor::shared();
    /// Each target's registrations, in the order they were made.
    std::unordered_map<const Object*, std::vector<Entry>> entries;

    void drop(const Object* key) noexcept override {
      auto node = entries.extract(key);
      if (node.empty()) return;
      std::vector<H> held;
      for (auto& e : node.mapped()) held.push_back(std::move(e.held));
      std::weak_ptr<Table> weak = this->weak_from_this();
      for (auto& h : held) {
        context.post([weak, h = std::move(h)]() mutable {
          auto self = weak.lock();
          if (!self) return;
          try {
            self->cleanup(std::move(h));
          } catch (...) {
            reportUncaught(std::current_exception(), "a FinalizationRegistry's cleanup");
          }
        });
      }
    }
  };

  template <class T>
  void add(const Ref<T>& target, H held, std::weak_ptr<void> token, bool tokened) {
    Object* o = detail::weakKeyOf(target);
    if constexpr (IsRef<H>::value) {
      if (held && static_cast<const void*>(detail::weakKeyOf(held)) == static_cast<const void*>(o))
        throwTypeError("FinalizationRegistry.register: target and held value must not be the same");
    }
    t_->entries[o].push_back(Entry{std::move(held), std::move(token), tokened});
    o->keyIn(t_);
  }

  std::shared_ptr<Table> t_;
};

template <class H>
String toJsString(const FinalizationRegistry<H>&) {
  return String::fromLatin1("[object FinalizationRegistry]");
}

template <class H>
bool strictEquals(const FinalizationRegistry<H>& a, const FinalizationRegistry<H>& b) {
  return a.identity() == b.identity();
}

template <class K, class V>
String toJsString(const WeakMap<K, V>&) {
  return String::fromLatin1("[object WeakMap]");
}

template <class K>
String toJsString(const WeakSet<K>&) {
  return String::fromLatin1("[object WeakSet]");
}

/// `===`: the same collection.
template <class K, class V>
bool strictEquals(const WeakMap<K, V>& a, const WeakMap<K, V>& b) {
  return a.identity() == b.identity();
}

template <class K>
bool strictEquals(const WeakSet<K>& a, const WeakSet<K>& b) {
  return a.identity() == b.identity();
}

}  // namespace lucent
