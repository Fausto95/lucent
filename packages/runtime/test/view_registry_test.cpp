// Unit tests for the registry the Android host finds each view's event
// emitter in (rn/LucentViewRegistry.h): by the view's surface and tag,
// since a tag alone is reused (each JavaScript runtime numbers its views
// again), holding nothing alive. Built and run by
// `packages/runtime/test/run.sh`, also under ASan/UBSan and TSan.
#include <cstdio>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "rn/LucentViewRegistry.h"

using lucent::views::ViewRegistry;

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

/// A reloaded runtime numbers its views again: the old surface's view and
/// the new one's share a tag, and each finds its own.
static void aTagReusedOnAnotherSurfaceFindsItsOwn() {
  ViewRegistry<std::string> registry;
  auto old = std::make_shared<std::string>("old runtime's view 3");
  auto fresh = std::make_shared<std::string>("new runtime's view 3");

  registry.record(1, 3, old);
  registry.record(11, 3, fresh);

  CHECK(registry.find(1, 3) == old);
  CHECK(registry.find(11, 3) == fresh);
  CHECK(registry.find(21, 3) == nullptr);
}

/// The renderer made another object for the same view: the latest counts.
static void theLatestRecordCounts() {
  ViewRegistry<std::string> registry;
  auto first = std::make_shared<std::string>("first");
  auto second = std::make_shared<std::string>("second");

  registry.record(1, 3, first);
  registry.record(1, 3, second);

  CHECK(registry.find(1, 3) == second);
}

/// It holds nothing alive: a view gone is found no more, and its entry
/// goes once the registry has doubled.
static void goneViewsAreForgotten() {
  ViewRegistry<std::string> registry;
  auto kept = std::make_shared<std::string>("kept");

  registry.record(1, 1, kept);

  for (int tag = 2; tag < 1000; ++tag) {
    auto gone = std::make_shared<std::string>("gone");
    registry.record(1, tag, gone);
  }

  CHECK(kept.use_count() == 1);
  CHECK(registry.find(1, 1) == kept);
  CHECK(registry.find(1, 999) == nullptr);
  CHECK(registry.size() <= 512);
}

/// The renderer records on its threads while the host finds on the main thread.
static void anyThreadRecordsAndFinds() {
  ViewRegistry<int> registry;
  std::vector<std::thread> threads;

  for (int surface = 0; surface < 4; ++surface)
    threads.emplace_back([&registry, surface] {
      for (int tag = 0; tag < 500; ++tag) {
        auto value = std::make_shared<int>(tag);
        registry.record(surface, tag, value);
        registry.find(surface, tag);
      }
    });

  for (auto& t : threads) t.join();

  CHECK(registry.size() <= 2048);
}

int main() {
  aTagReusedOnAnotherSurfaceFindsItsOwn();
  theLatestRecordCounts();
  goneViewsAreForgotten();
  anyThreadRecordsAndFinds();

  std::printf("view registry: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
