// The executor bench (T109): synthetic 1080p frames at 60 Hz, run on an
// executor as a camera's delegate is (the platform's work on the executor,
// entering it at once), into a `latest` channel module code subscribes
// to, while a synchronous call from JavaScript holds the module's actor
// for 500 ms. The handler never waits for the actor, the channel counts
// what module code was too busy to take, and the handler's latency (from
// the frame's due time to its handler's start) is reported. Built and run
// by `packages/runtime/test/run.sh`, also under ASan/UBSan and TSan.
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdint>
#include <cstring>
#include <memory>
#include <thread>
#include <vector>

#include "lucent/buffer.h"
#include "lucent/channel.h"
#include "lucent/lucent.h"
#include "lucent/native.h"
#include "lucent/trace.h"

using namespace lucent;
using Clock = std::chrono::steady_clock;

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
static bool within(int ms, F done) {
  auto deadline = Clock::now() + std::chrono::milliseconds(ms);
  while (!done()) {
    if (Clock::now() > deadline) return false;
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }
  return true;
}

static void busy(int ms) {
  auto until = Clock::now() + std::chrono::milliseconds(ms);
  while (Clock::now() < until) {
  }
}

static double msSince(Clock::time_point at) {
  return std::chrono::duration<double, std::milli>(Clock::now() - at).count();
}

/// The `q` quantile of `values` (sorted here), by the nearest rank.
static double quantile(std::vector<double> values, double q) {
  std::sort(values.begin(), values.end());
  size_t rank = static_cast<size_t>(std::ceil(q * static_cast<double>(values.size())));
  return values[std::min(values.size(), std::max<size_t>(rank, 1)) - 1];
}

static void framesNeverWaitForTheActor() {
  constexpr int kFrames = 90;  // 1.5 s at 60 Hz
  constexpr auto kPeriod = std::chrono::microseconds(16'667);
  constexpr size_t kFrameBytes = 1920 * 1080 * 4;  // RGBA
  constexpr int kHoldMs = 500;

  // A frame is the platform's pixels, adopted without a copy, as a camera's buffer is.
  static std::vector<uint8_t> pixels(kFrameBytes);

  Actor& module = Actor::create("bench.module");
  auto frames = ExecutorContext::create("bench.frames");
  auto latest = ChannelObject<NativeBuffer>::create(ChannelPolicy::Latest, 1);

  // What the executor's jobs write, kept alive however the test ends.
  struct Run {
    std::vector<double> latencies = std::vector<double>(kFrames, 0);
    std::atomic<int> handled{0};
    std::atomic<int> taken{0};
  };
  auto run = std::make_shared<Run>();

  // Module code takes frames as it can, on its actor.
  EventSubscription subscription;
  std::atomic<bool> subscribed{false};
  module.post([&, run] {
    subscription = latest->subscribe(Fn<void(NativeBuffer)>([run](NativeBuffer frame) {
      if (frame && frame->size() == kFrameBytes) run->taken++;
    }));
    subscribed = true;
  });
  CHECK(within(2000, [&] { return subscribed.load(); }));

  trace::start();

  // A synchronous call from JavaScript holds the actor, from the first frame on.
  std::atomic<bool> holding{false};
  std::thread js([&] {
    LucentScope call(module);
    holding = true;
    busy(kHoldMs);
  });
  CHECK(within(2000, [&] { return holding.load(); }));

  // The camera: each frame due 16.7 ms after the last, run on the executor.
  auto start = Clock::now();
  for (int i = 0; i < kFrames; i++) {
    auto due = start + kPeriod * i;
    std::this_thread::sleep_until(due);
    frames->execute([run, latest, frames, i, due] {
      callNowIn(*frames, [&] {
        run->latencies[i] = msSince(due);
        latest->send(NativeBufferObject::adopt(pixels.data(), kFrameBytes, [](uint8_t*, size_t) {}));
        run->handled++;
      });
    });
  }
  js.join();
  CHECK(within(20'000, [&] { return run->handled.load() == kFrames; }));
  CHECK(within(20'000, [&] { return frames->waitIdle(100) && module.waitIdle(100); }));

  std::vector<trace::Event> events = trace::events();
  trace::stop();

  // No wait for any actor's lock on the executor.
  int waits = 0;
  for (const trace::Event& e : events)
    if (e.category == trace::Category::Lock && e.context == frames->id()) waits++;
  CHECK(waits == 0);

  // A handler waiting for the actor would start the hold late, about 500 ms, on the first
  // frame: p99 well under it (a shared, sanitized runner may still be slow to schedule).
  double p50 = quantile(run->latencies, 0.5);
  double p99 = quantile(run->latencies, 0.99);
  CHECK(p99 < kHoldMs * 0.8);

  // While the actor was held, module code took none: the latest channel kept the newest.
  ChannelStats stats = latest->stats();
  CHECK(stats.sent == kFrames);
  CHECK(stats.dropped > 0);
  CHECK(run->taken.load() + stats.dropped + stats.depth == kFrames);

  std::printf(
      "executor bench: %d frames of %.1f MB at 60 Hz; handler latency p50 %.3f ms, p99 %.3f ms; "
      "actor held %d ms; dropped %llu, taken %d; actor waits on the executor %d\n",
      kFrames, static_cast<double>(kFrameBytes) / 1e6, p50, p99, kHoldMs,
      static_cast<unsigned long long>(stats.dropped), run->taken.load(), waits);

  if (subscription) subscription->remove();
  frames->shutdown();
}

int main() {
  framesNeverWaitForTheActor();

  std::printf("executor: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
