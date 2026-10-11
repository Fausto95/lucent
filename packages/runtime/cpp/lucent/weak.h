// Lucent runtime — WeakMap and WeakSet.
//
// Keys are objects (class instances, interface values, object values),
// compared by identity, and held weakly: an entry goes with its key's last
// strong reference, at once, its value with it (as a WeakRef's target goes).
// The key knows the tables it is in (Object::keyIn), and its destructor
// drops its entries. There is no iteration, as in JavaScript. A collection
// and its keys belong to one context, like a WeakRef.
#pragma once

#include <memory>
#include <type_traits>
#include <unordered_map>
#include <unordered_set>
#include <utility>

#include "core.h"
#include "jsstring.h"

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
