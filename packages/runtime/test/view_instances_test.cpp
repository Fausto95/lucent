// Unit tests for the ids instance props travel by (rn/LucentViewInstances.h):
// one id per instance while it lives, holding nothing, and safe from any
// thread, as React Native parses commits on its own threads while
// JavaScript gives ids on its. Built and run by
// `packages/runtime/test/run.sh`, also under ASan/UBSan and TSan.
#include <atomic>
#include <cstdio>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "rn/LucentViewInstances.h"

using lucent::Object;
using lucent::Ref;
using lucent::views::instanceIds;
using lucent::views::kInstancesPerRuntime;

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

struct Player : Object {};

/// An instance keeps its id, its runtime's, while it lives; another has its own.
static void anInstanceKeepsItsId() {
  auto a = std::make_shared<Player>();
  auto b = std::make_shared<Player>();
  double id = instanceIds().idOf(1, a);

  CHECK(instanceIds().idOf(1, a) == id);
  CHECK(instanceIds().idOf(1, b) != id);
  CHECK(id >= kInstancesPerRuntime && id < 2 * kInstancesPerRuntime);

  std::string why;
  CHECK(instanceIds().find(id, why) == a);
}

/// The ids hold nothing: a freed instance's id finds nothing, and an
/// instance made at its address gets an id of its own.
static void anIdHoldsNothing() {
  auto a = std::make_shared<Player>();
  double id = instanceIds().idOf(2, a);
  std::weak_ptr<Player> weak = a;

  a.reset();

  std::string why;
  CHECK(weak.expired());
  CHECK(!instanceIds().find(id, why) && why == "the id of no instance alive");

  auto again = std::make_shared<Player>();
  CHECK(instanceIds().idOf(2, again) != id);
}

/// A torn-down runtime's ids name nothing, though its instances live on.
static void aTornDownRuntimesIdsNameNothing() {
  auto a = std::make_shared<Player>();
  double id = instanceIds().idOf(3, a);

  instanceIds().forget(3);

  std::string why;
  CHECK(!instanceIds().find(id, why) && why == "an instance of a JavaScript runtime that was torn down");
  CHECK(instanceIds().entries(3) == 0);
  CHECK(!instanceIds().find(0.5, why) && why == "not an instance's id");
}

/// Entries of instances gone are swept as ids are given.
static void goneInstancesAreSwept() {
  for (int i = 0; i < 2000; ++i) instanceIds().idOf(4, std::make_shared<Player>());

  CHECK(instanceIds().entries(4) <= 256);
}

/// Ids given on one thread, found on others, instances freed on a third.
static void idsAreSafeFromAnyThread() {
  std::vector<Ref<Object>> kept;
  std::vector<double> ids;

  for (int i = 0; i < 64; ++i) {
    kept.push_back(std::make_shared<Player>());
    ids.push_back(instanceIds().idOf(5, kept.back()));
  }

  std::atomic<int> found{0};
  std::vector<std::thread> threads;

  for (int t = 0; t < 3; ++t)
    threads.emplace_back([&] {
      std::string why;
      for (int pass = 0; pass < 100; ++pass)
        for (double id : ids)
          if (instanceIds().find(id, why)) found++;
    });

  threads.emplace_back([] {
    for (int i = 0; i < 1000; ++i) instanceIds().idOf(5, std::make_shared<Player>());
  });

  for (auto& t : threads) t.join();

  CHECK(found == 3 * 100 * 64);
}

int main() {
  anInstanceKeepsItsId();
  anIdHoldsNothing();
  aTornDownRuntimesIdsNameNothing();
  goneInstancesAreSwept();
  idsAreSafeFromAnyThread();

  std::printf("view instances: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
