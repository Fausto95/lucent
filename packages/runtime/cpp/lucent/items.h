// Lucent runtime — a toolkit body's list, by key.
//
// A SwiftUI or Compose body shows an array its setup computes item by
// item, each told apart by a key (a string or a number) its key function
// computes. The setup's effect keeps the latest items by key, so an
// action a callback of an item calls with the item's key runs with the
// item itself, or not at all once the item is gone. Keys are unique:
// two items with one key, or a NaN key, are an error.
#pragma once

#include <cmath>
#include <map>
#include <type_traits>

#include "core.h"
#include "jserror.h"
#include "jsstring.h"
#include "number.h"

namespace lucent::ui {

template <class K, class T>
class Items {
 public:
  /// Forgets the items: a new array is being keyed.
  void clear() { byKey_.clear(); }

  /// Keeps `item` under `key`, which no other item has.
  void add(const K& key, const T& item) {
    if constexpr (std::is_same_v<K, double>) {
      if (std::isnan(key)) throwError(String::fromLatin1("Error"), String::fromLatin1("a list's key is NaN"));
    }

    if (!byKey_.emplace(key, item).second)
      throwError(String::fromLatin1("Error"), String::fromLatin1("two items of a list have the key ") + text(key));
  }

  /// The item with `key`, if there is one still.
  Opt<T> find(const K& key) const {
    auto it = byKey_.find(key);

    return it == byKey_.end() ? Opt<T>() : Opt<T>(it->second);
  }

 private:
  std::map<K, T> byKey_;

  static String text(const String& key) { return key; }
  static String text(double key) { return numberToString(key); }
};

}  // namespace lucent::ui
