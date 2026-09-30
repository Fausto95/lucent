// The fixture's events, dispatched through React Native's own event
// dispatcher and queue (as the prebuilt framework has them): what reaches
// JavaScript at each beat, in which order, at which priority, and what a
// coalesced event replaces. Two Gauges (a discrete onChange and onReset, a
// coalesced onDrag) and a Picker (a continuous onPick). Prints one line per
// event delivered; event-run.test.ts checks them.
#include <views/LucentGauge_9f3932d52a2f.h>
#include <views/LucentPicker_8770a845170b.h>

#include <hermes/hermes.h>
#include <react/renderer/core/EventBeat.h>
#include <react/renderer/core/EventDispatcher.h>
#include <react/renderer/core/EventQueueProcessor.h>
#include <react/renderer/core/EventTarget.h>
#include <react/renderer/core/InstanceHandle.h>
#include <react/renderer/runtimescheduler/RuntimeScheduler.h>

#include <cstdio>
#include <memory>
#include <optional>
#include <string>

namespace gauge = lucent::views::LucentGauge_9f3932d52a2f;
namespace picker = lucent::views::LucentPicker_8770a845170b;
namespace jsi = facebook::jsi;
namespace react = facebook::react;

namespace {

/** A beat the renderer requests and the test runs: each run flushes what waits. */
class Beat final : public react::EventBeat {
 public:
  Beat(std::shared_ptr<OwnerBox> owner, react::RuntimeScheduler& scheduler)
      : EventBeat(std::move(owner), scheduler) {}

  void request() const override {}
  void requestSynchronous() const override {}

  void run(jsi::Runtime& runtime) const { beatCallback_(runtime); }
};

const char* priority(react::ReactEventPriority p) {
  switch (p) {
    case react::ReactEventPriority::Discrete:
      return "discrete";
    case react::ReactEventPriority::Continuous:
      return "continuous";
    case react::ReactEventPriority::Idle:
      return "idle";
    case react::ReactEventPriority::Default:
      return "default";
  }

  return "?";
}

std::shared_ptr<react::EventTarget> target(jsi::Runtime& runtime, react::Tag tag) {
  return std::make_shared<react::EventTarget>(
      std::make_shared<react::InstanceHandle>(runtime, jsi::Object(runtime), tag), 1);
}

void run() {
  auto hermes = facebook::hermes::makeHermesRuntime();
  jsi::Runtime& runtime = *hermes;

  react::RuntimeScheduler scheduler([](std::function<void(jsi::Runtime&)>&&) {});
  auto owner = std::make_shared<react::EventBeat::OwnerBox>();
  auto beat = std::make_unique<Beat>(owner, scheduler);
  const Beat& beats = *beat;

  // Each event JavaScript would receive: the view's tag, its type, its priority, its arguments.
  react::EventQueueProcessor processor(
      [](jsi::Runtime& rt,
         const react::EventTarget* to,
         const std::string& type,
         react::ReactEventPriority p,
         const react::EventPayload& payload,
         react::HighResTimeStamp) {
        auto args = payload.asJSIValue(rt).asObject(rt).getProperty(rt, "args");
        auto json = rt.global().getPropertyAsObject(rt, "JSON").getPropertyAsFunction(rt, "stringify");

        std::printf(
            "%d %s %s %s\n", to ? static_cast<int>(to->getTag()) : -1, type.c_str(), priority(p), json.call(rt, args).getString(rt).utf8(rt).c_str());
      },
      [](jsi::Runtime&) {},
      [](const react::StateUpdate&) {},
      {});

  auto dispatcher = std::make_shared<react::EventDispatcher>(
      processor, std::move(beat), [](const react::StateUpdate&) {}, std::weak_ptr<react::EventLogger>{});

  gauge::EventEmitter a(target(runtime, 2), dispatcher);
  gauge::EventEmitter b(target(runtime, 4), dispatcher);
  picker::EventEmitter p(target(runtime, 6), dispatcher);

  std::printf("beat 1\n");

  // A coalesced event replaces the view's waiting one of its type: 2 is sent, not 1.
  a.emit(gauge::Event2{1});
  a.emit(gauge::Event2{2});

  // Not across another of the view's events: 3 waits after the change, and 4 replaces it.
  a.emit(gauge::Event0{5, std::nullopt});
  a.emit(gauge::Event2{3});
  a.emit(gauge::Event2{4});

  // Another view's events are its own; a later value takes the place of the one it replaces.
  b.emit(gauge::Event2{7});
  a.emit(gauge::Event2{5});

  // Continuous events are each delivered, in order; discrete ones too.
  p.emit(picker::Event0{"a", std::nullopt});
  p.emit(picker::Event0{"b", "tap"});
  b.emit(gauge::Event1{});

  beats.run(runtime);

  // Once delivered, nothing is replaced: the next value waits for the next beat.
  std::printf("beat 2\n");
  a.emit(gauge::Event2{6});
  beats.run(runtime);
}

}  // namespace

int main() { run(); }
