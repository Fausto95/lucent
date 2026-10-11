// Unit tests for what a debug build reports of the runtime (T61,
// lucent/debug.h): the live count of each kind of thing it owns (scopes,
// pending operations, resources, a view's effects, signals and computed
// values, native references), each back to where it was once its owner
// goes; what a last reference closed while still open; and the cycles of
// strong references among the objects alive. Built and run by `packages/runtime/test/run.sh`, also under
// ASan/UBSan and TSan.
#include <algorithm>
#include <cstdio>
#include <future>
#include <memory>
#include <string>
#include <vector>

#include "lucent/buffer.h"
#include "lucent/debug.h"
#include "lucent/events.h"
#include "lucent/lucent.h"
#include "lucent/reactive.h"
#include "lucent/refs.h"

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

template <class F>
static void onMain(F f) {
  std::promise<void> done;
  ExecutionContext::main().post([&] {
    f();
    done.set_value();
  });
  done.get_future().wait();
}

// Each kind counts what lives of it, and nothing once its owner has gone.
static void countsWhatLives() {
  const debug::Resources before = debug::resources();

  {
    auto scope = Scope::create(0);
    auto pending = Operation<void>::start(scope);
    auto file = Resource::open(String::fromUtf8("file"), [] {});

    const debug::Resources now = debug::resources();
    CHECK(now.scopes == before.scopes + 1);
    CHECK(now.operations == before.operations + 1);
    CHECK(now.resources == before.resources + 1);

    file->close();
    scope->dispose();
  }

  const debug::Resources after = debug::resources();
  CHECK(after.scopes == before.scopes);
  CHECK(after.operations == before.operations);
  CHECK(after.resources == before.resources);
}

// A view's reactive graph: its effects, signals and computed values.
static void countsAViewsGraph() {
  onMain([] {
    const debug::Resources before = debug::resources();

    {
      auto g = ui::Graph::create();
      auto a = ui::signal(g, 1.0);
      auto doubled = ui::computed(g, [a] { return a.get() * 2; });
      auto e = ui::effect(g, [doubled] { (void)doubled.get(); });

      const debug::Resources now = debug::resources();
      CHECK(now.signals == before.signals + 1);
      CHECK(now.computeds == before.computeds + 1);
      CHECK(now.effects == before.effects + 1);

      e.dispose();
      g->dispose();
    }

    const debug::Resources after = debug::resources();
    CHECK(after.signals == before.signals);
    CHECK(after.computeds == before.computeds);
    CHECK(after.effects == before.effects);
  });
}

// What its last reference closed while still open: a resource or a native
// buffer's storage, never one closed first.
static void countsBackstops() {
  const long before = live::backstops;

  { auto file = Resource::open(String::fromUtf8("file"), [] {}); }
  CHECK(live::backstops == before + 1);

  {
    auto closed = Resource::open(String::fromUtf8("closed"), [] {});
    closed->close();
  }
  CHECK(live::backstops == before + 1);

  { auto pixels = NativeBufferObject::allocate(4); }
  CHECK(live::backstops == before + 2);

  {
    auto pixels = NativeBufferObject::allocate(4);
    pixels->close();
    auto moved = NativeBufferObject::allocate(4)->transfer();
    moved->close();
  }
  CHECK(live::backstops == before + 2);
}

// --- reference cycles ---------------------------------------------------------------

namespace {

/// Classes as the compiler emits them: each reports its fields' references.
struct Child;
struct Parent : Object {
  Array<Ref<Child>> children;
  void lucentRefs_(debug::RefSink& s) const override { debug::refs(s, children, "Parent.children", "tree.lucent.ts:3"); }
};
struct Child : Object {
  Opt<Ref<Parent>> parent;
  Ref<WeakRefObject<Ref<Parent>>> weakParent;
  void lucentRefs_(debug::RefSink& s) const override {
    debug::refs(s, parent, "Child.parent", "tree.lucent.ts:9");
    debug::refs(s, weakParent, "Child.weakParent", "tree.lucent.ts:10");
  }
};
struct Node : Object {
  Map<String, Ref<Node>> next;
  void lucentRefs_(debug::RefSink& s) const override { debug::refs(s, next, "Node.next", ""); }
};

/// The cycles found now that are new, described.
std::vector<std::string> newCycles() {
  std::vector<std::string> out;
  for (const auto& c : debug::cycles(true)) out.push_back(debug::describe(c));
  return out;
}

}  // namespace

// A cycle of strong references is found, from its oldest object, once; a
// back reference through a WeakRef is none, and neither is a chain.
static void findsCyclesOnce() {
  debug::trackObjects();
  CHECK(debug::tracksObjects());
  CHECK(newCycles().empty());

  // A tree whose children hold their parent weakly: no cycle.
  auto weakTree = std::make_shared<Parent>();
  auto leaf = std::make_shared<Child>();
  leaf->weakParent = std::make_shared<WeakRefObject<Ref<Parent>>>(weakTree);
  weakTree->children.push(leaf);
  leaf.reset();
  CHECK(newCycles().empty());

  // Holding it strongly makes one, reported from the parent, made first.
  {
    auto parent = std::make_shared<Parent>();
    auto child = std::make_shared<Child>();
    parent->children.push(child);
    child->parent = parent;
  }
  auto found = newCycles();
  CHECK(found.size() == 1);
  CHECK(!found.empty() &&
        found[0] ==
            "a reference cycle keeps 2 objects alive: Parent.children (tree.lucent.ts:3), then Child.parent (tree.lucent.ts:9), back "
            "to the first. Hold Child.parent through a WeakRef to break it.");

  // Reported once: a later look finds it again only when asked for all.
  CHECK(newCycles().empty());
  CHECK(debug::cycles(false).size() == 1);

  // An object that refers to itself, and a ring of three through a map.
  {
    auto self = std::make_shared<Node>();
    self->next.set(String::fromUtf8("self"), self);
    auto a = std::make_shared<Node>(), b = std::make_shared<Node>(), c = std::make_shared<Node>();
    a->next.set(String::fromUtf8("b"), b);
    b->next.set(String::fromUtf8("c"), c);
    c->next.set(String::fromUtf8("a"), a);
  }
  found = newCycles();
  CHECK(found.size() == 2);
  std::sort(found.begin(), found.end());
  CHECK(!found.empty() && found[0] ==
                              "a reference cycle keeps 1 object alive: Node.next, to itself. Hold Node.next through a "
                              "WeakRef to break it.");
  CHECK(found.size() == 2 && found[1].rfind("a reference cycle keeps 3 objects alive: Node.next, then Node.next, then Node.next", 0) == 0);
}

namespace {

/// A class holding a closure, as the compiler makes one when it captures objects.
struct Session : Object {
  Fn<void()> onFrame;
  void lucentRefs_(debug::RefSink& s) const override { debug::refs(s, onFrame, "Session.onFrame", "camera.lucent.ts:2"); }
};

}  // namespace

// A cycle through a closure: a field holds it, and it captures the object;
// one through an emitter's listener; a closure that captures itself
// through a box is read once.
static void findsCyclesThroughClosures() {
  debug::trackObjects();
  newCycles();

  {
    auto session = std::make_shared<Session>();
    session->onFrame = lucent::closure("camera.lucent.ts:41", "this,count", [](Ref<Session>& self, double& count) { count++; },
                                       Ref<Session>(session), 0.0);
  }
  auto found = newCycles();
  CHECK(found.size() == 1);
  CHECK(!found.empty() && found[0] ==
                              "a reference cycle keeps 1 object alive: Session.onFrame (camera.lucent.ts:2), then the closure at "
                              "camera.lucent.ts:41, which captures this, to itself. Capture a WeakRef of this in the closure at "
                              "camera.lucent.ts:41 to break it.");

  // The captures stay the closure's: a mutable one keeps its changes.
  auto counter = std::make_shared<Session>();
  Box<double> calls(0);
  counter->onFrame = lucent::closure("camera.lucent.ts:50", "calls", [](Box<double>& calls) { (*calls)++; }, calls);
  counter->onFrame();
  counter->onFrame();
  CHECK(*calls == 2);
  CHECK(newCycles().empty());

  // A listener of an emitter the object holds, which captures the object.
  struct Camera : Object {
    Ref<EventEmitterObject<Fn<void(double)>>> frames = EventEmitterObject<Fn<void(double)>>::create({"frame"});
    void lucentRefs_(debug::RefSink& s) const override { debug::refs(s, frames, "Camera.frames", "camera.lucent.ts:60"); }
  };
  {
    auto camera = std::make_shared<Camera>();
    camera->frames->addListener<0>(
        lucent::closure("camera.lucent.ts:64", "this", [](Ref<Camera>&, double) {}, Ref<Camera>(camera)));
  }
  found = newCycles();
  CHECK(found.size() == 1);
  CHECK(!found.empty() && found[0] ==
                              "a reference cycle keeps 2 objects alive: Camera.frames (camera.lucent.ts:60), then the frame "
                              "listener, then the closure at camera.lucent.ts:64, which captures this, back to the first. "
                              "Capture a WeakRef of this in the closure at camera.lucent.ts:64 to break it.");

  // A closure that captures itself, through a box: read once, and no cycle of objects.
  auto self = std::make_shared<Session>();
  Box<Fn<void()>> slot;
  *slot = lucent::closure("loop.lucent.ts:3", "loop", [](Box<Fn<void()>>&) {}, slot);
  self->onFrame = *slot;
  CHECK(newCycles().empty());
  *slot = Fn<void()>();
}

// Native references are the runtime's own count (liveNativeRefs).
static void countsNativeReferences() {
  CHECK(debug::resources().nativeRefs == liveNativeRefs());
}

int main() {
  countsWhatLives();
  countsAViewsGraph();
  countsBackstops();
  findsCyclesOnce();
  findsCyclesThroughClosures();
  countsNativeReferences();

  std::printf("debug: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
