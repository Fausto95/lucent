// Lucent runtime — Map, Set and Dict (string-keyed plain objects), all
// iterating in insertion order like their JavaScript counterparts.
#pragma once

#include <cmath>
#include <cstring>
#include <memory>
#include <unordered_map>
#include <vector>

#include "array.h"
#include "core.h"
#include "equality.h"

namespace lucent {

namespace detail {

template <class K>
struct KeyHash {
  size_t operator()(const K& k) const {
    if constexpr (std::is_same_v<K, double>) {
      if (std::isnan(k)) return 0x7ff8;
      double v = k == 0 ? 0.0 : k;  // -0 and +0 are the same key
      uint64_t bits;
      std::memcpy(&bits, &v, sizeof bits);
      return std::hash<uint64_t>()(bits);
    } else if constexpr (std::is_same_v<K, bool>) {
      return k ? 1 : 2;
    } else if constexpr (std::is_same_v<K, String>) {
      return k.hash();
    } else if constexpr (IsRef<K>::value) {
      return std::hash<const void*>()(static_cast<const void*>(k.get()));
    } else {
      return std::hash<const void*>()(k.identity());
    }
  }
};

template <class K>
struct KeyEq {
  bool operator()(const K& a, const K& b) const { return sameValueZero(a, b); }
};

// Insertion-ordered hash table. Deleted entries leave tombstones so an
// iteration in progress keeps its position; they are compacted later.
template <class K, class V>
class OrderedTable {
 public:
  struct Entry {
    K key;
    V value;
    bool live;
  };

  size_t size() const { return live_; }
  size_t slotCount() const { return entries_.size(); }
  bool slotLive(size_t i) const { return entries_[i].live; }
  const Entry& slot(size_t i) const { return entries_[i]; }
  Entry& slot(size_t i) { return entries_[i]; }

  Entry* find(const K& k) {
    auto it = index_.find(k);
    return it == index_.end() ? nullptr : &entries_[it->second];
  }
  const Entry* find(const K& k) const {
    auto it = index_.find(k);
    return it == index_.end() ? nullptr : &entries_[it->second];
  }
  void set(const K& k, V v) {
    auto it = index_.find(k);
    if (it != index_.end()) {
      entries_[it->second].value = std::move(v);
      return;
    }
    maybeCompact();
    index_.emplace(k, entries_.size());
    entries_.push_back(Entry{k, std::move(v), true});
    live_++;
  }
  bool remove(const K& k) {
    auto it = index_.find(k);
    if (it == index_.end()) return false;
    Entry& e = entries_[it->second];
    e.live = false;
    e.value = V();
    index_.erase(it);
    live_--;
    return true;
  }
  void clear() {
    for (auto& e : entries_) {
      e.live = false;
      e.value = V();
    }
    index_.clear();
    live_ = 0;
  }
  /// Iteration guard: compaction is deferred while any iteration is active.
  struct Iterating {
    explicit Iterating(OrderedTable& t) : t_(t) { t_.iterators_++; }
    ~Iterating() { t_.iterators_--; }
    OrderedTable& t_;
  };

 private:
  void maybeCompact() {
    if (iterators_ > 0 || entries_.size() < 16 || live_ * 2 > entries_.size()) return;
    std::vector<Entry> kept;
    kept.reserve(live_ + 1);
    for (auto& e : entries_) {
      if (e.live) kept.push_back(std::move(e));
    }
    entries_.swap(kept);
    index_.clear();
    for (size_t i = 0; i < entries_.size(); i++) index_.emplace(entries_[i].key, i);
  }

  std::vector<Entry> entries_;
  std::unordered_map<K, size_t, KeyHash<K>, KeyEq<K>> index_;
  size_t live_ = 0;
  int iterators_ = 0;
};

struct Empty {};

}  // namespace detail

template <class K, class V>
class Map {
 public:
  using Table = detail::OrderedTable<K, V>;
  Map() : t_(std::make_shared<Table>()) {}

  double size() const { return static_cast<double>(t_->size()); }
  Opt<V> get(const K& k) const {
    if (auto* e = t_->find(k)) return e->value;
    return undefined;
  }
  bool has(const K& k) const { return t_->find(k) != nullptr; }
  Map& set(const K& k, V v) {
    t_->set(k, std::move(v));
    return *this;
  }
  bool remove(const K& k) { return t_->remove(k); }
  void clear() { t_->clear(); }

  template <class F>
  void forEach(F&& f) const {
    typename Table::Iterating guard(*t_);
    for (size_t i = 0; i < t_->slotCount(); i++) {
      if (!t_->slotLive(i)) continue;
      K k = t_->slot(i).key;
      V v = t_->slot(i).value;
      invokeCallback(f, v, k, *this);
    }
  }
  Array<K> keys() const {
    Array<K> out;
    for (size_t i = 0; i < t_->slotCount(); i++) {
      if (t_->slotLive(i)) out.push(t_->slot(i).key);
    }
    return out;
  }
  Array<V> values() const {
    Array<V> out;
    for (size_t i = 0; i < t_->slotCount(); i++) {
      if (t_->slotLive(i)) out.push(t_->slot(i).value);
    }
    return out;
  }

  Table& table() const { return *t_; }
  const void* identity() const { return t_.get(); }
  friend bool strictEquals(const Map& a, const Map& b) { return a.t_ == b.t_; }
  friend String toJsString(const Map&) { return String::fromLatin1("[object Map]"); }

 private:
  std::shared_ptr<Table> t_;
};

template <class T>
class Set {
 public:
  using Table = detail::OrderedTable<T, detail::Empty>;
  Set() : t_(std::make_shared<Table>()) {}
  explicit Set(const Array<T>& items) : Set() {
    for (const auto& v : items.items()) add(static_cast<T>(v));
  }

  double size() const { return static_cast<double>(t_->size()); }
  bool has(const T& v) const { return t_->find(v) != nullptr; }
  Set& add(const T& v) {
    if (!t_->find(v)) t_->set(v, detail::Empty{});
    return *this;
  }
  bool remove(const T& v) { return t_->remove(v); }
  void clear() { t_->clear(); }
  template <class F>
  void forEach(F&& f) const {
    typename Table::Iterating guard(*t_);
    for (size_t i = 0; i < t_->slotCount(); i++) {
      if (!t_->slotLive(i)) continue;
      T v = t_->slot(i).key;
      invokeCallback(f, v, v, *this);
    }
  }
  Array<T> values() const {
    Array<T> out;
    for (size_t i = 0; i < t_->slotCount(); i++) {
      if (t_->slotLive(i)) out.push(t_->slot(i).key);
    }
    return out;
  }
  Array<T> keys() const { return values(); }

  Table& table() const { return *t_; }
  const void* identity() const { return t_.get(); }
  friend bool strictEquals(const Set& a, const Set& b) { return a.t_ == b.t_; }
  friend String toJsString(const Set&) { return String::fromLatin1("[object Set]"); }

 private:
  std::shared_ptr<Table> t_;
};

/// `Record<string, V>` / `{ [key: string]: V }`: a plain object used as a
/// dictionary.
template <class V>
class Dict {
 public:
  using Table = detail::OrderedTable<String, V>;
  Dict() : t_(std::make_shared<Table>()) {}

  Opt<V> get(const String& k) const {
    if (auto* e = t_->find(k)) return e->value;
    return undefined;
  }
  void set(const String& k, V v) { t_->set(k, std::move(v)); }
  bool has(const String& k) const { return t_->find(k) != nullptr; }
  bool remove(const String& k) { return t_->remove(k); }
  size_t count() const { return t_->size(); }

  /// Object.keys order: integer-like keys ascending, then insertion order.
  Array<String> keys() const {
    std::vector<std::pair<double, String>> numeric;
    Array<String> rest;
    for (size_t i = 0; i < t_->slotCount(); i++) {
      if (!t_->slotLive(i)) continue;
      const String& k = t_->slot(i).key;
      double index;
      if (isArrayIndex(k, index)) numeric.emplace_back(index, k);
      else rest.push(k);
    }
    if (numeric.empty()) return rest;
    std::stable_sort(numeric.begin(), numeric.end(), [](const auto& a, const auto& b) { return a.first < b.first; });
    Array<String> out;
    for (auto& p : numeric) out.push(p.second);
    out.append(rest);
    return out;
  }
  Array<V> values() const {
    Array<V> out;
    Array<String> ks = keys();
    for (const auto& k : ks.items()) out.push(t_->find(k)->value);
    return out;
  }

  Table& table() const { return *t_; }
  const void* identity() const { return t_.get(); }
  friend bool strictEquals(const Dict& a, const Dict& b) { return a.t_ == b.t_; }
  friend String toJsString(const Dict&) { return String::fromLatin1("[object Object]"); }

  static bool isArrayIndex(const String& k, double& out) {
    size_t n = k.length();
    if (n == 0 || n > 10) return false;
    if (n > 1 && k.unit(0) == '0') return false;
    double v = 0;
    for (size_t i = 0; i < n; i++) {
      char16_t c = k.unit(i);
      if (c < '0' || c > '9') return false;
      v = v * 10 + (c - '0');
    }
    if (v >= 4294967295.0) return false;
    out = v;
    return true;
  }

 private:
  std::shared_ptr<Table> t_;
};

}  // namespace lucent
