// Unit tests for what a debug build reports of the runtime (T61,
// lucent/debug.h): the live count of each kind of thing it owns (scopes,
// pending operations, resources, a view's effects, signals and computed
// values, native references), each back to where it was once its owner
// goes. Built and run by `packages/runtime/test/run.sh`, also under
// ASan/UBSan and TSan.
#include <cstdio>
#include <future>
#include <memory>

#include "lucent/debug.h"
#include "lucent/lucent.h"
#include "lucent/reactive.h"

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

// Native references are the runtime's own count (liveNativeRefs).
static void countsNativeReferences() {
  CHECK(debug::resources().nativeRefs == liveNativeRefs());
}

int main() {
  countsWhatLives();
  countsAViewsGraph();
  countsNativeReferences();

  std::printf("debug: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
