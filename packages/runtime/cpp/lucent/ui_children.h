// Lucent runtime — a native view's children that come and go (T49): a
// keyed list, and a conditional child.
//
// A parent's children are regions in order: fixed children, and dynamic
// regions whose size changes. A region's children start after those of
// the regions before it, so each region inserts at its offset plus its own
// index.
//
// A keyed list keeps, for each key, the item's signal, the scope its views
// live in and its view. Reconciling a new array removes the keys it no
// longer has (disposing their scopes once), writes a kept key's new item
// to its signal (only that item's bindings rerun), makes the new keys'
// views in scopes of their own, then walks the new order and puts each
// child in place: a move where the parent moves, else a remove and an
// insert. `[a,b,c]` to `[c,a,b]` is one move. Keys are unique, and a
// number key is never NaN: an array breaking that throws before anything
// changes.
//
// A conditional child is one of several branches, or none: an effect
// computes which; when it changes, the old branch's scope ends (its view
// leaves) and the new one is made in a scope of its own.
#pragma once

#include <algorithm>
#include <functional>
#include <map>
#include <memory>
#include <utility>
#include <vector>

#include "core.h"
#include "items.h"
#include "reactive.h"
#include "scope.h"

namespace lucent::ui {

/// What a parent view does with its children natively, by the methods its
/// class declares. `move` is optional: without it, a remove and an insert.
template <class V>
struct ChildOps {
  std::function<void(const V& child, int index)> insert;
  std::function<void(const V& child)> remove;
  std::function<void(const V& child, int from, int to)> move;
};

/// A parent's children as regions in order, each its current size.
class ChildRegions {
 public:
  /// A region of `count` children after the others; its number.
  size_t add(int count) {
    counts_.push_back(count);
    return counts_.size() - 1;
  }

  void resize(size_t region, int count) { counts_.at(region) = count; }

  /// Where `region`'s children start among the parent's.
  int offset(size_t region) const {
    int at = 0;
    for (size_t i = 0; i < region; i++) at += counts_.at(i);
    return at;
  }

 private:
  std::vector<int> counts_;
};

/// What reconciling an array did.
struct ChildChanges {
  int created = 0;
  int removed = 0;
  int moved = 0;
  int updated = 0;
};

template <class K, class T>
using KeyOf = std::function<K(const T&)>;

/// A keyed list of children: one view per key, `make` setting each up in
/// its own scope (a child of `owner`) from the item's signal.
template <class K, class T, class V>
class KeyedList {
 public:
  using Make = std::function<V(const Signal<T>& item)>;

  KeyedList(std::shared_ptr<Graph> graph, std::shared_ptr<Scope> owner, ChildOps<V> ops,
            std::shared_ptr<ChildRegions> regions, size_t region, Make make)
      : graph_(std::move(graph)),
        owner_(std::move(owner)),
        ops_(std::move(ops)),
        regions_(std::move(regions)),
        region_(region),
        make_(std::move(make)) {}

  ChildChanges update(const Array<T>& items, const KeyOf<K, T>& keyOf) {
    ChildChanges changes;

    // Keys first: an array breaking their rules changes nothing.
    std::vector<K> keys;
    Items<K, bool> unique;
    for (size_t i = 0; i < items.size(); i++) {
      keys.push_back(keyOf(items.at(i)));
      unique.add(keys.back(), true);
    }

    // The keys it no longer has.
    std::vector<K> present = order_;
    for (auto it = present.begin(); it != present.end();) {
      if (unique.find(*it).has()) {
        ++it;
        continue;
      }
      Entry gone = std::move(entries_.at(*it));
      entries_.erase(*it);
      ops_.remove(gone.view);
      gone.scope->dispose();
      changes.removed++;
      it = present.erase(it);
    }

    // Kept keys take their new item; new keys are set up.
    std::vector<K> made;
    for (size_t i = 0; i < items.size(); i++) {
      auto found = entries_.find(keys[i]);
      if (found != entries_.end()) {
        if (!sameValue(found->second.item.peek(), items.at(i))) {
          found->second.item.set(items.at(i));
          changes.updated++;
        }
        continue;
      }

      auto scope = Scope::create(owner_->runtime(), owner_);
      auto item = signal(graph_, items.at(i));
      V view = graph_->untracked([&] { return graph_->within(scope, [&] { return make_(item); }); });
      entries_.emplace(keys[i], Entry{item, scope, std::move(view)});
      made.push_back(keys[i]);
    }

    // Each child in place, walking the new order.
    const int at = regions_->offset(region_);
    for (size_t i = 0; i < keys.size(); i++) {
      const Entry& e = entries_.at(keys[i]);
      auto now = std::find(present.begin(), present.end(), keys[i]);

      if (now == present.end()) {
        ops_.insert(e.view, at + static_cast<int>(i));
        present.insert(present.begin() + static_cast<long>(i), keys[i]);
        changes.created++;
        continue;
      }

      const auto from = static_cast<size_t>(now - present.begin());
      if (from == i) continue;

      if (ops_.move) {
        ops_.move(e.view, at + static_cast<int>(from), at + static_cast<int>(i));
      } else {
        ops_.remove(e.view);
        ops_.insert(e.view, at + static_cast<int>(i));
      }
      present.erase(now);
      present.insert(present.begin() + static_cast<long>(i), keys[i]);
      changes.moved++;
    }

    order_ = std::move(keys);
    regions_->resize(region_, static_cast<int>(order_.size()));
    return changes;
  }

 private:
  struct Entry {
    Signal<T> item;
    std::shared_ptr<Scope> scope;
    V view;
  };

  std::shared_ptr<Graph> graph_;
  std::shared_ptr<Scope> owner_;
  ChildOps<V> ops_;
  std::shared_ptr<ChildRegions> regions_;
  size_t region_;
  Make make_;
  std::map<K, Entry> entries_;
  std::vector<K> order_;
};

/// A conditional child in `region` of a parent: `which` says which branch
/// (-1 for none), and `build` sets one up in its own scope (a child of the
/// scope it is made in). An effect of that scope.
template <class V>
void branch(const std::shared_ptr<Graph>& graph, ChildOps<V> ops, std::shared_ptr<ChildRegions> regions,
            size_t region, std::function<int()> which, std::function<V(int)> build) {
  struct Shown {
    int which = -1;
    std::shared_ptr<Scope> scope;
    std::optional<V> view;
  };

  auto owner = graph->scope();
  auto shown = std::make_shared<Shown>();

  // Gone with the scope it is made in: the branch shown ends with it.
  owner->onDispose([shown] {
    if (shown->scope) shown->scope->dispose();
  });

  effect(graph, [graph, ops, regions, region, which, build, owner, shown] {
    const int next = which();
    if (next == shown->which) return;

    graph->untracked([&] {
      if (shown->view) {
        ops.remove(*shown->view);
        shown->scope->dispose();
        shown->view.reset();
        shown->scope.reset();
      }

      shown->which = next;
      regions->resize(region, 0);
      if (next < 0) return;

      shown->scope = Scope::create(owner->runtime(), owner);
      shown->view = graph->within(shown->scope, [&] { return build(next); });
      ops.insert(*shown->view, regions->offset(region));
      regions->resize(region, 1);
    });
  }, "branch");
}

}  // namespace lucent::ui
