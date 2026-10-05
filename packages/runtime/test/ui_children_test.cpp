// Unit tests for a native view's children that come and go (T49,
// lucent/ui_children.h): a keyed list reconciled against a recording
// backend (the reference backend: each insert, remove and move logged),
// the scope each item lives in, and a conditional child. Built and run by
// `packages/runtime/test/run.sh`, also under ASan/UBSan and TSan.
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <future>
#include <map>
#include <memory>
#include <random>
#include <string>
#include <vector>

#include "lucent/lucent.h"
#include "lucent/reactive.h"
#include "lucent/ui_children.h"

using namespace lucent;

static int failures = 0;
static int checks = 0;

#define CHECK(cond)                                                                 \
  do {                                                                              \
    checks++;                                                                       \
    if (!(cond)) {                                                                  \
      failures++;                                                                   \
      std::fprintf(stderr, "%s:%d: CHECK failed: %s\n", __FILE__, __LINE__, #cond); \
    }                                                                               \
  } while (0)

/// Runs `f` as a turn of the UI (main) context and returns its result.
template <class F>
static auto onUi(F f) -> decltype(f()) {
  using R = decltype(f());
  std::promise<R> result;
  auto future = result.get_future();

  ExecutionContext::main().post([&] {
    if constexpr (std::is_void_v<R>) {
      f();
      result.set_value();
    } else {
      result.set_value(f());
    }
  });

  if (future.wait_for(std::chrono::seconds(10)) != std::future_status::ready) {
    std::fprintf(stderr, "a UI turn did not run within 10 s\n");
    std::abort();
  }

  return future.get();
}

namespace fixture {

/// An item of a list: compared by identity, as JavaScript objects are.
struct Item {
  std::string key;
  std::string title;
};

using ItemRef = std::shared_ptr<Item>;

ItemRef item(std::string key, std::string title = "") { return std::make_shared<Item>(Item{std::move(key), std::move(title)}); }

/// A native view: its name, and the title its binding last set.
struct View {
  std::string name;
  std::shared_ptr<std::string> title = std::make_shared<std::string>();
};

/// The reference backend: a parent's children, and every operation on them.
struct Parent {
  std::vector<std::string> children;
  std::vector<std::string> log;

  ui::ChildOps<View> ops(bool moves) {
    ui::ChildOps<View> o;
    o.insert = [this](const View& v, int at) {
      children.insert(children.begin() + at, v.name);
      log.push_back("insert " + v.name + " " + std::to_string(at));
    };
    o.remove = [this](const View& v) {
      children.erase(std::find(children.begin(), children.end(), v.name));
      log.push_back("remove " + v.name);
    };
    if (moves)
      o.move = [this](const View& v, int from, int to) {
        children.erase(children.begin() + from);
        children.insert(children.begin() + to, v.name);
        log.push_back("move " + v.name + " " + std::to_string(from) + " " + std::to_string(to));
      };
    return o;
  }

  std::string order() const {
    std::string out;
    for (auto& c : children) out += c;
    return out;
  }
};

/// What the items' scopes did: how many were set up, and cleaned up, and
/// how many of their pending tasks were cancelled.
struct Lives {
  int made = 0;
  int ended = 0;
  int titled = 0;
  int cancelled = 0;
};

}  // namespace fixture

using fixture::Item;
using fixture::ItemRef;
using fixture::View;

/// A list under `parent` after `before` fixed children: each item a view
/// whose title is a binding (an effect reading the item's signal), a
/// cleanup and a task that never settles, counted in `lives`.
static std::shared_ptr<ui::KeyedList<String, ItemRef, View>> listOf(
    const std::shared_ptr<ui::Graph>& g, const std::shared_ptr<Scope>& mount, fixture::Parent& parent,
    const std::shared_ptr<ui::ChildRegions>& regions, size_t region, bool moves, fixture::Lives& lives) {
  auto make = [g, &lives](const ui::Signal<ItemRef>& item) {
    lives.made++;
    View v{item.peek()->key};
    auto title = v.title;
    ui::effect(g, [item, title, &lives] {
      *title = item.get()->title;
      lives.titled++;
    });
    g->onCleanup([&lives] { lives.ended++; });

    auto task = Operation<void>::start(g->scope());
    task->onSettled([&lives](const Operation<void>::Outcome& outcome) {
      if (outcome.state == OperationState::Cancelled) lives.cancelled++;
    });

    return v;
  };

  return std::make_shared<ui::KeyedList<String, ItemRef, View>>(g, mount, parent.ops(moves), regions, region, make);
}

static ui::KeyOf<String, ItemRef> byKey = [](const ItemRef& r) { return String::fromUtf8(r->key); };

static Array<ItemRef> items(std::initializer_list<ItemRef> list) {
  Array<ItemRef> out;
  for (auto& r : list) out.push(r);
  return out;
}

// §16.7: [a,b,c] → [c,a,b] creates and removes nothing, and moves one child
// once with a backend that moves, or with a remove and an insert without.
static void movesOneChildForARotation() {
  for (bool moves : {true, false}) {
    onUi([moves] {
      auto g = ui::Graph::create();
      auto mount = Scope::create(0);
      fixture::Parent parent;
      fixture::Lives lives;
      auto regions = std::make_shared<ui::ChildRegions>();
      auto list = listOf(g, mount, parent, regions, regions->add(0), moves, lives);

      auto a = fixture::item("a"), b = fixture::item("b"), c = fixture::item("c");
      g->within(mount, [&] { list->update(items({a, b, c}), byKey); });
      CHECK(parent.order() == "abc");
      parent.log.clear();

      auto changes = g->within(mount, [&] { return list->update(items({c, a, b}), byKey); });
      CHECK(parent.order() == "cab");
      CHECK(changes.created == 0);
      CHECK(changes.removed == 0);
      CHECK(changes.moved == 1);
      CHECK(lives.made == 3);
      CHECK(lives.ended == 0);
      if (moves) {
        CHECK(parent.log.size() == 1);
        CHECK(parent.log.at(0) == "move c 2 0");
      } else {
        CHECK(parent.log.size() == 2);
      }

      mount->dispose();
      CHECK(lives.ended == 3);
    });
  }
}

// An item kept under its key but replaced by another object: only its own
// binding runs again; its view and scope stay.
static void updatesOnlyTheReplacedItem() {
  onUi([] {
    auto g = ui::Graph::create();
    auto mount = Scope::create(0);
    fixture::Parent parent;
    fixture::Lives lives;
    auto regions = std::make_shared<ui::ChildRegions>();
    auto list = listOf(g, mount, parent, regions, regions->add(0), true, lives);

    auto a = fixture::item("a", "first"), b = fixture::item("b", "second");
    g->within(mount, [&] { list->update(items({a, b}), byKey); });
    CHECK(lives.titled == 2);

    auto renamed = fixture::item("a", "renamed");
    auto changes = g->within(mount, [&] { return list->update(items({renamed, b}), byKey); });
    CHECK(changes.updated == 1);
    CHECK(changes.created == 0);
    CHECK(lives.titled == 3);
    CHECK(lives.made == 2);
    CHECK(parent.log.size() == 2);  // the two first inserts only

    mount->dispose();
  });
}

// A removed item's scope ends once, with its effects; reinserted, the key
// is a new item, set up again.
static void endsARemovedItemOnce() {
  onUi([] {
    auto g = ui::Graph::create();
    auto mount = Scope::create(0);
    fixture::Parent parent;
    fixture::Lives lives;
    auto regions = std::make_shared<ui::ChildRegions>();
    auto list = listOf(g, mount, parent, regions, regions->add(0), true, lives);

    auto a = fixture::item("a"), b = fixture::item("b"), c = fixture::item("c");
    g->within(mount, [&] { list->update(items({a, b, c}), byKey); });

    auto changes = g->within(mount, [&] { return list->update(items({a, c}), byKey); });
    CHECK(changes.removed == 1);
    CHECK(lives.ended == 1);
    CHECK(parent.order() == "ac");

    // b's binding no longer runs: its effect ended with its scope.
    auto titled = lives.titled;
    g->within(mount, [&] { list->update(items({a, c}), byKey); });
    CHECK(lives.titled == titled);

    changes = g->within(mount, [&] { return list->update(items({a, b, c}), byKey); });
    CHECK(changes.created == 1);
    CHECK(lives.made == 4);
    CHECK(parent.order() == "abc");

    mount->dispose();
    CHECK(lives.ended == 4);
  });
}

// Two items with one key: an error naming it, and the children as they were.
static void refusesDuplicateKeys() {
  onUi([] {
    auto g = ui::Graph::create();
    auto mount = Scope::create(0);
    fixture::Parent parent;
    fixture::Lives lives;
    auto regions = std::make_shared<ui::ChildRegions>();
    auto list = listOf(g, mount, parent, regions, regions->add(0), true, lives);

    auto a = fixture::item("a"), b = fixture::item("b");
    g->within(mount, [&] { list->update(items({a, b}), byKey); });

    std::string message;
    try {
      g->within(mount, [&] { list->update(items({a, fixture::item("b"), fixture::item("b")}), byKey); });
    } catch (...) {
      message = currentError(std::current_exception())->message.toUtf8();
    }
    CHECK(message == "two items of a list have the key b");
    CHECK(parent.order() == "ab");
    CHECK(lives.made == 2);

    mount->dispose();
  });
}

// Regions under one parent: a list after fixed children and before
// another list inserts where its region starts.
static void insertsWhereItsRegionStarts() {
  onUi([] {
    auto g = ui::Graph::create();
    auto mount = Scope::create(0);
    fixture::Parent parent;
    fixture::Lives lives;
    auto regions = std::make_shared<ui::ChildRegions>();

    parent.children = {"H"};
    regions->add(1);
    auto first = listOf(g, mount, parent, regions, regions->add(0), true, lives);
    auto second = listOf(g, mount, parent, regions, regions->add(0), true, lives);

    g->within(mount, [&] { second->update(items({fixture::item("x"), fixture::item("y")}), byKey); });
    g->within(mount, [&] { first->update(items({fixture::item("a"), fixture::item("b")}), byKey); });
    CHECK(parent.order() == "Habxy");

    g->within(mount, [&] { first->update(items({fixture::item("b")}), byKey); });
    g->within(mount, [&] { second->update(items({fixture::item("y"), fixture::item("x")}), byKey); });
    CHECK(parent.order() == "Hbyx");

    mount->dispose();
  });
}

// A conditional child: none, then one branch, then another; each branch's
// scope ends when another takes its place, and with the mount.
static void switchesBranches() {
  onUi([] {
    auto g = ui::Graph::create();
    auto mount = Scope::create(0);
    fixture::Parent parent;
    auto regions = std::make_shared<ui::ChildRegions>();
    parent.children = {"H"};
    regions->add(1);
    auto region = regions->add(0);
    regions->add(1);
    parent.children.push_back("F");

    auto which = ui::signal(g, -1.0);
    int made = 0, ended = 0;
    g->within(mount, [&] {
      ui::branch<View>(g, parent.ops(false), regions, region, [which] { return static_cast<int>(which.get()); },
                       [g, &made, &ended](int i) {
                         made++;
                         g->onCleanup([&ended] { ended++; });
                         return View{i == 0 ? "A" : "B"};
                       });
    });
    CHECK(parent.order() == "HF");

    g->transaction([&] { which.set(0.0); });
    CHECK(parent.order() == "HAF");
    CHECK(made == 1);

    // The same branch again: nothing is made.
    g->transaction([&] { which.set(0.0); });
    CHECK(made == 1);

    g->transaction([&] { which.set(1.0); });
    CHECK(parent.order() == "HBF");
    CHECK(made == 2);
    CHECK(ended == 1);

    g->transaction([&] { which.set(-1.0); });
    CHECK(parent.order() == "HF");
    CHECK(ended == 2);

    g->transaction([&] { which.set(0.0); });
    mount->dispose();
    CHECK(ended == 3);
  });
}

// Reorders, deletions and reinsertions at random: the children always follow
// the array, and every item set up ends exactly once, its task cancelled.
static void survivesRandomReorders() {
  onUi([] {
    auto g = ui::Graph::create();
    auto mount = Scope::create(0);
    fixture::Parent parent;
    fixture::Lives lives;
    auto regions = std::make_shared<ui::ChildRegions>();
    auto list = listOf(g, mount, parent, regions, regions->add(0), true, lives);

    std::mt19937 random(49);
    std::map<std::string, ItemRef> pool;
    for (char k = 'a'; k <= 'p'; k++) pool[std::string(1, k)] = fixture::item(std::string(1, k));

    for (int round = 0; round < 500; round++) {
      std::vector<std::string> keys;
      for (auto& [k, _] : pool)
        if (random() % 3) keys.push_back(k);
      std::shuffle(keys.begin(), keys.end(), random);

      Array<ItemRef> next;
      std::string expected;
      for (auto& k : keys) {
        // Sometimes another object under the same key.
        if (random() % 5 == 0) pool[k] = fixture::item(k, std::to_string(round));
        next.push(pool[k]);
        expected += k;
      }

      g->within(mount, [&] { list->update(next, byKey); });
      CHECK(parent.order() == expected);
      CHECK(lives.made - lives.ended == static_cast<int>(keys.size()));
      CHECK(lives.cancelled == lives.ended);
    }

    mount->dispose();
    CHECK(lives.made == lives.ended);
    CHECK(lives.cancelled == lives.made);
  });
}

int main() {
  movesOneChildForARotation();
  updatesOnlyTheReplacedItem();
  endsARemovedItemOnce();
  refusesDuplicateKeys();
  insertsWhereItsRegionStarts();
  switchesBranches();
  survivesRandomReorders();

  std::printf("ui_children: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
