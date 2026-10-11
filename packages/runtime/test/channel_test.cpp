// Unit tests for channels (lucent/channel.h, T74): values from a producer
// on any thread to a consumer on its own context, under the channel's
// policy when the consumer falls behind (lossless, latest, drop); dropped
// native buffers closed once; closing, and the scope's disposal. Built and
// run by `packages/runtime/test/run.sh`, also under ASan/UBSan and TSan.
#include <atomic>
#include <chrono>
#include <cstdio>
#include <cstdlib>
#include <future>
#include <memory>
#include <string>
#include <thread>
#include <vector>

#include "lucent/buffer.h"
#include "lucent/channel.h"
#include "lucent/lucent.h"

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

using Clock = std::chrono::steady_clock;

/// Polls `done` for up to `ms` milliseconds.
template <class F>
static bool within(int ms, F done) {
  auto deadline = Clock::now() + std::chrono::milliseconds(ms);

  while (!done()) {
    if (Clock::now() > deadline) return false;
    std::this_thread::sleep_for(std::chrono::milliseconds(1));
  }

  return true;
}

/// Runs `f` as one turn of `context`, and waits for it.
template <class F>
static void inTurn(ExecutionContext& context, F f) {
  std::promise<void> done;
  auto future = done.get_future();
  context.post([&] {
    f();
    done.set_value();
  });
  if (future.wait_for(std::chrono::seconds(5)) != std::future_status::ready) {
    std::fprintf(stderr, "a turn did not run within 5 s\n");
    std::abort();
  }
}

/// The error `f` throws: its name, or empty if it throws none.
template <class F>
static std::string thrown(F f) {
  try {
    f();
  } catch (const Exception& e) {
    return e.error()->name.toUtf8();
  }

  return "";
}

/// What a channel of numbers holds now, received on `context` until it would wait.
static std::vector<double> drained(ExecutionContext& context, const Channel<double>& channel) {
  std::vector<double> out;
  inTurn(context, [&] {
    while (channel->stats().depth > 0) {
      auto p = channel->receive();
      CHECK(p.settled());
      out.push_back(p.value().get());
    }
  });

  return out;
}

// --- policies ---------------------------------------------------------------------

/// Lossless: bounded; a send into a full channel is refused and keeps nothing.
static void losslessRefusesWhenFull() {
  auto context = IsolatedContext::create();
  auto channel = ChannelObject<double>::create(ChannelPolicy::Lossless, 2);

  CHECK(channel->send(1) && channel->send(2));
  CHECK(!channel->send(3));
  CHECK(channel->stats().depth == 2 && channel->stats().refused == 1 && channel->stats().dropped == 0);
  CHECK((drained(*context, channel) == std::vector<double>{1, 2}));

  CHECK(channel->send(4));
  CHECK((drained(*context, channel) == std::vector<double>{4}));
  CHECK(channel->stats().sent == 3 && channel->stats().received == 3 && channel->stats().highWater == 2);

  context->shutdown();
}

/// Latest: one slot; a send replaces what waits there, and counts it dropped.
static void latestKeepsTheNewest() {
  auto context = IsolatedContext::create();
  auto channel = ChannelObject<double>::create(ChannelPolicy::Latest, 1);

  for (double v : {1, 2, 3}) CHECK(channel->send(v));
  CHECK(channel->stats().depth == 1 && channel->stats().dropped == 2);
  CHECK((drained(*context, channel) == std::vector<double>{3}));

  context->shutdown();
}

/// Drop: bounded; a send into a full channel drops the oldest value.
static void dropLosesTheOldest() {
  auto context = IsolatedContext::create();
  auto channel = ChannelObject<double>::create(ChannelPolicy::Drop, 3);

  for (double v : {1, 2, 3, 4, 5}) CHECK(channel->send(v));
  CHECK(channel->stats().dropped == 2 && channel->stats().highWater == 3);
  CHECK((drained(*context, channel) == std::vector<double>{3, 4, 5}));

  context->shutdown();
}

/// A capacity is a whole number from 1; latest's is 1.
static void capacitiesAreWholeNumbers() {
  CHECK(thrown([] { ChannelObject<double>::create(ChannelPolicy::Lossless, 0); }) == "RangeError");
  CHECK(thrown([] { ChannelObject<double>::create(ChannelPolicy::Drop, 1.5); }) == "RangeError");
  CHECK(thrown([] { ChannelObject<double>::create(ChannelPolicy::Latest, 2); }) == "RangeError");
  CHECK(thrown([] { ChannelObject<double>::create(ChannelPolicy::Latest, 1); }).empty());
}

// --- the consumer -----------------------------------------------------------------

/// A receive waits until a value is sent, from any thread, and settles on
/// the consumer's context; values arrive in the order sent.
static void receivesSettleOnTheConsumer() {
  auto consumer = IsolatedContext::create();
  auto channel = ChannelObject<double>::create(ChannelPolicy::Lossless, 64);
  std::vector<double> got;
  std::atomic<bool> onConsumer{true};
  std::atomic<bool> done{false};

  // A consumer loop: each value, then the next receive, until undefined.
  std::function<void()> next;
  next = [&] {
    auto p = channel->receive();
    p.onSettled([&, p] {
      if (!consumer->isCurrent()) onConsumer = false;
      if (!p.value().has()) {
        done = true;
        return;
      }
      got.push_back(p.value().get());
      next();
    });
  };
  inTurn(*consumer, [&] { next(); });

  std::thread producer([&] {
    for (int i = 0; i < 50; i++) CHECK(channel->send(i));
    channel->close();
  });
  producer.join();

  CHECK(within(2000, [&] { return done.load(); }));
  CHECK(onConsumer.load());
  CHECK(got.size() == 50);
  bool ordered = true;
  for (size_t i = 0; i < got.size(); i++) ordered = ordered && got[i] == static_cast<double>(i);
  CHECK(ordered);

  consumer->shutdown();
}

/// A send never waits for the consumer: a producer keeps sending while the
/// consumer's context is busy, and the policy decides what waits.
static void sendsNeverWaitForTheConsumer() {
  auto consumer = IsolatedContext::create();
  auto channel = ChannelObject<double>::create(ChannelPolicy::Latest, 1);
  std::promise<void> release;
  auto busy = release.get_future().share();

  consumer->post([busy] { busy.wait(); });

  auto start = Clock::now();
  for (int i = 0; i < 1000; i++) channel->send(i);
  CHECK(Clock::now() - start < std::chrono::seconds(1));
  CHECK(channel->stats().depth == 1 && channel->stats().dropped == 999);

  release.set_value();
  CHECK((drained(*consumer, channel) == std::vector<double>{999}));

  consumer->shutdown();
}

// --- closing ----------------------------------------------------------------------

/// Closed, a channel refuses sends; the consumer still receives what was
/// queued, then undefined, and a receive waiting then settles undefined.
static void closingLetsTheConsumerDrain() {
  auto context = IsolatedContext::create();
  auto channel = ChannelObject<double>::create(ChannelPolicy::Lossless, 4);

  channel->send(1);
  channel->send(2);
  CHECK(channel->close() && !channel->close());
  CHECK(channel->closed());
  CHECK(!channel->send(3));
  CHECK(channel->stats().refused == 1);

  std::vector<std::string> got;
  inTurn(*context, [&] {
    for (int i = 0; i < 3; i++) {
      auto p = channel->receive();
      got.push_back(p.value().has() ? std::to_string(static_cast<int>(p.value().get())) : "undefined");
    }
  });
  CHECK((got == std::vector<std::string>{"1", "2", "undefined"}));

  auto waiting = ChannelObject<double>::create(ChannelPolicy::Lossless, 4);
  Promise<Opt<double>> pending;
  inTurn(*context, [&] { pending = waiting->receive(); });
  CHECK(!pending.settled());
  waiting->close();
  CHECK(within(2000, [&] { return pending.settled(); }));
  CHECK(!pending.value().has());

  context->shutdown();
}

/// Disposing the channel's scope closes it and releases what was never
/// received; so does its last reference going.
static void disposalReleasesTheRest() {
  auto context = IsolatedContext::create();
  auto scope = Scope::create(0);
  auto channel = ChannelObject<NativeBuffer>::create(ChannelPolicy::Lossless, 4, scope);
  auto a = NativeBufferObject::allocate(4);
  auto b = NativeBufferObject::allocate(4);
  channel->send(a);
  channel->send(b);

  scope->dispose();
  CHECK(channel->closed());
  CHECK(!a->isOpen() && !b->isOpen());
  CHECK(channel->stats().depth == 0 && channel->stats().dropped == 2);

  auto c = NativeBufferObject::allocate(4);
  {
    auto dropped = ChannelObject<NativeBuffer>::create(ChannelPolicy::Lossless, 4);
    dropped->send(c);
  }
  CHECK(!c->isOpen());

  // Under a scope already disposed, a channel is closed at once.
  auto late = ChannelObject<double>::create(ChannelPolicy::Lossless, 1, scope);
  CHECK(late->closed() && !late->send(1));

  context->shutdown();
}

// --- native buffers ---------------------------------------------------------------

/// A buffer a policy drops is closed, once; one the consumer receives is
/// its to close, and one a full lossless channel refused stays the
/// producer's, open.
static void droppedBuffersAreClosedOnce() {
  auto context = IsolatedContext::create();
  const uint64_t releasedBefore = NativeBufferObject::stats().released;

  auto latest = ChannelObject<NativeBuffer>::create(ChannelPolicy::Latest, 1);
  auto first = NativeBufferObject::allocate(8);
  auto second = NativeBufferObject::allocate(8);
  latest->send(first);
  latest->send(second);
  CHECK(!first->isOpen() && second->isOpen());

  NativeBuffer got;
  inTurn(*context, [&] { got = latest->receive().value().get(); });
  CHECK(got == second && got->isOpen());

  auto full = ChannelObject<NativeBuffer>::create(ChannelPolicy::Lossless, 1);
  auto kept = NativeBufferObject::allocate(8);
  auto refused = NativeBufferObject::allocate(8);
  full->send(kept);
  CHECK(!full->send(refused));
  CHECK(refused->isOpen());

  // Released once: the drop closed `first`, and nothing closed it again.
  CHECK(NativeBufferObject::stats().released == releasedBefore + 1);

  got->close();
  full->close();
  context->shutdown();
}

/// Many producers on many threads, one consumer: every accepted value
/// arrives once, and accepted + refused is every send.
static void producersRaceOneConsumer() {
  auto consumer = IsolatedContext::create();
  auto channel = ChannelObject<double>::create(ChannelPolicy::Lossless, 32);
  std::atomic<long> accepted{0};
  std::atomic<long> got{0};
  std::atomic<bool> done{false};

  std::function<void()> next;
  next = [&] {
    auto p = channel->receive();
    p.onSettled([&, p] {
      if (!p.value().has()) {
        done = true;
        return;
      }
      got++;
      next();
    });
  };
  inTurn(*consumer, [&] { next(); });

  std::vector<std::thread> producers;
  for (int t = 0; t < 4; t++)
    producers.emplace_back([&] {
      for (int i = 0; i < 500; i++)
        if (channel->send(i)) accepted++;
    });
  for (auto& p : producers) p.join();
  channel->close();

  CHECK(within(5000, [&] { return done.load(); }));
  CHECK(got.load() == accepted.load());
  CHECK(static_cast<long>(channel->stats().sent) == accepted.load());
  CHECK(static_cast<long>(channel->stats().sent + channel->stats().refused) == 2000);

  consumer->shutdown();
}

int main() {
  losslessRefusesWhenFull();
  latestKeepsTheNewest();
  dropLosesTheOldest();
  capacitiesAreWholeNumbers();
  receivesSettleOnTheConsumer();
  sendsNeverWaitForTheConsumer();
  closingLetsTheConsumerDrain();
  disposalReleasesTheRest();
  droppedBuffersAreClosedOnce();
  producersRaceOneConsumer();

  std::printf("channel: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
