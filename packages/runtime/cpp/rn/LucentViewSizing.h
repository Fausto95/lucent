// Lucent runtime — how Fabric sizes a Lucent component (lucent/sizing.h has
// the exchange itself).
//
// A component with a size of its own (explicit, or given by flex) fills it:
// the platform hosts lay the setup's view out in the host's content box (its
// frame less border and padding) at every layout. A component without one is
// sized by its content: its shadow node is a measurable Yoga leaf that lays
// out at the latest measurement its state holds (none before the first: zero),
// and records in its state the constraints its layout asked for. The host
// (HostSizing, main thread) measures its view under them, and again after
// the mount's code ran (it may have changed the view: lucent/view.h's
// Content), and posts the result as a state update, which the renderer
// applies on its own thread if the result is still current. No thread
// waits for another: the first frame shows the component at its last size
// (zero on mount), and the next commit at its measured one. The renderer
// applies state updates on the JavaScript thread, so while that thread is
// busy a measured size waits for it (committing them from the main thread
// instead, unstable_Immediate, cost up to 20 ms of it per update on an
// Android emulator).
#pragma once

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/core/ConcreteState.h>
#include <react/renderer/core/LayoutConstraints.h>
#include <react/renderer/core/LayoutContext.h>

#ifdef RN_SERIALIZABLE_STATE
#include <folly/dynamic.h>
#endif

#if defined(__ANDROID__)
#include <sys/system_properties.h>
#endif

#include <lucent/report.h>
#include <lucent/sizing.h>
#include <lucent/slots.h>
#include <lucent/view.h>

#include <atomic>
#include <chrono>
#include <cstdarg>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <memory>
#include <optional>
#include <utility>

namespace lucent::views {

/// Whether sizing traces its steps (LUCENT_SIZING_TRACE=1; on Android the
/// debug.lucent.sizing system property): measurements, requests and
/// verdicts, as LUCENT_SIZING lines in the platform's log.
inline bool sizingTraced() {
  static const bool traced = [] {
#if defined(__ANDROID__)
    char property[PROP_VALUE_MAX] = {};

    if (__system_property_get("debug.lucent.sizing", property) > 0) return std::strcmp(property, "1") == 0;
#endif
    const char* variable = std::getenv("LUCENT_SIZING_TRACE");

    return variable != nullptr && std::strcmp(variable, "1") == 0;
  }();

  return traced;
}

/// One LUCENT_SIZING line (printf format), stamped with the time since the first, when sizing is traced.
inline void traceSizing(const char* format, ...) {
  if (!sizingTraced()) return;

  static const auto start = std::chrono::steady_clock::now();
  auto ms = std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now() - start).count();
  char line[256];
  va_list args;

  va_start(args, format);
  std::vsnprintf(line, sizeof line, format, args);
  va_end(args);

  char stamped[288];

  std::snprintf(stamped, sizeof stamped, "LUCENT_SIZING %.1f ms %s", ms, line);
  logError(stamped);
}

/** A component's size state, as the renderer keeps it with its shadow node. */
struct SizeStateData : sizing::SizeState {
  /// A component taking React children: where its host last reported its
  /// slot (LucentViewSlots.h). None before the first report.
  std::optional<slots::Placement> slot;

  SizeStateData() = default;

#ifdef RN_SERIALIZABLE_STATE
  // Android's renderer can update states from Java; nothing on the Java
  // side does for this one: the host posts its results from C++.
  SizeStateData(const SizeStateData& previous, folly::dynamic /*data*/) : SizeStateData(previous) {}

  folly::dynamic getDynamic() const { return folly::dynamic::object(); }
#endif
};

/**
 * A component's shadow node: a measurable leaf, sized by its host's
 * measurement when its style and flex leave it a size to find.
 */
template <const char* Name, typename PropsT, typename EmitterT>
class HostShadowNode final
    : public facebook::react::ConcreteViewShadowNode<Name, PropsT, EmitterT, SizeStateData> {
  using Base = facebook::react::ConcreteViewShadowNode<Name, PropsT, EmitterT, SizeStateData>;

 public:
  using Base::Base;

  static facebook::react::ShadowNodeTraits BaseTraits() {
    auto traits = Base::BaseTraits();

    traits.set(facebook::react::ShadowNodeTraits::Trait::LeafYogaNode);
    traits.set(facebook::react::ShadowNodeTraits::Trait::MeasurableYogaNode);

    return traits;
  }

  /// The latest measurement, within `constraints`; never waits for the host.
  facebook::react::Size measureContent(
      const facebook::react::LayoutContext& /*context*/,
      const facebook::react::LayoutConstraints& constraints) const override {
    asked_ = sizing::Constraints{
        static_cast<float>(constraints.maximumSize.width), static_cast<float>(constraints.maximumSize.height)};

    auto size = sizing::layoutSize(this->getStateData());

    return constraints.clamp(facebook::react::Size{size.width, size.height});
  }

  /// Laid out: asks the host to measure under the constraints of the
  /// layout's latest measure, with its font scale and direction, unless
  /// the measurement the state holds answers them (sizing::request).
  void layout(facebook::react::LayoutContext context) override {
    Base::layout(context);

    if (!asked_) return;

    auto asked = *asked_;

    asked.fontScale = static_cast<float>(context.fontSizeMultiplier);
    asked.direction = this->getLayoutMetrics().layoutDirection == facebook::react::LayoutDirection::RightToLeft
        ? sizing::Direction::RightToLeft
        : sizing::Direction::LeftToRight;

    const auto& state = this->getStateData();
    auto requested = sizing::request(state, asked, static_cast<float>(context.pointScaleFactor));

    if (!requested) return;

    auto next = state;

    next.requested = requested;
    traceSizing(
        "%d request %gx%g x%g%s",
        this->getTag(),
        requested->maxWidth,
        requested->maxHeight,
        requested->fontScale,
        requested->direction == sizing::Direction::RightToLeft ? " rtl" : "");
    this->setStateData(std::move(next));
  }

 private:
  /// The bounds of this node's latest measure in its layout.
  mutable std::optional<sizing::Constraints> asked_;
};

/**
 * A host's side of sizing, for one mount (main thread): the state of the
 * latest commit it mounted, its Measurer, and the mount's Content, which
 * the host enters to call the mount (setup, commits, commands) and the
 * setup's functions enter when they run. Once any entry ends, the content
 * counts as changed: it is measured again if the shadow tree needs its
 * size, as it is when a commit's state asks for other constraints.
 */
class HostSizing {
 public:
  using State = facebook::react::ConcreteState<SizeStateData>;

  /// The content's size within the constraints (unbounded axes: none), or
  /// nothing when there is no content to measure. Main thread.
  using Measure = std::function<std::optional<sizing::Size>(sizing::Constraints)>;

  HostSizing() = default;

  // Its Content calls back into it where it is.
  HostSizing(const HostSizing&) = delete;
  HostSizing& operator=(const HostSizing&) = delete;

  /// A mount starts on the view `tag` names, at `scale` pixels per point,
  /// its content measured by `measure`: revision 1, measured from scratch.
  void start(float scale, int tag, Measure measure) {
    measurer_ = sizing::Measurer(scale);
    lastPost_.reset();
    tag_ = tag;
    measure_ = std::move(measure);
    content_ = ui::Content::create([this] { contentChanged(); });
    traceSizing("%d start", tag_);
  }

  /// The mount ends: nothing it does reaches the host any more.
  void stop() {
    if (content_) traceSizing("%d stop", tag_);

    content_.reset();
    measure_ = nullptr;
    state_.reset();
    lastPost_.reset();
  }

  /// What the host enters to call the mount (ui::ContentEntry).
  std::weak_ptr<ui::Content> content() const { return content_; }

  /// The state of the commit being mounted.
  void setState(const facebook::react::State::Shared& state) {
    state_ = std::static_pointer_cast<const State>(state);

    if (!state_) return;

    const auto& data = state_->getData();

    measurer_.observe(data);

    if (data.measured)
      traceSizing(
          "%d mounted rev %llu: %gx%g",
          tag_,
          static_cast<unsigned long long>(data.measured->revision),
          data.measured->size.width,
          data.measured->size.height);
  }

  /// The content changed (its code ran, or it asked for a layout): a new
  /// revision, measured if the shadow tree needs its size.
  void contentChanged() {
    measurer_.contentChanged();
    traceSizing("%d content rev %llu", tag_, static_cast<unsigned long long>(measurer_.revision()));
    measure();
  }

  /// Measures if the state asks for constraints this content revision has
  /// not been measured under, and posts a result the state lacks.
  void measure() {
    if (!state_ || !measure_) return;

    const auto& data = state_->getData();
    auto constraints = measurer_.due(data);

    if (!constraints) return;

    auto size = measure_(*constraints);

    if (!size) return;

    std::optional<sizing::Measurement> pending;

    if (lastPost_ && !lastPost_->judged->load(std::memory_order_acquire)) pending = lastPost_->measurement;

    auto result = measurer_.record(data, *constraints, *size, pending);

    traceSizing(
        "%d measure rev %llu under %gx%g x%g%s: %gx%g %s",
        tag_,
        static_cast<unsigned long long>(measurer_.revision()),
        constraints->maxWidth,
        constraints->maxHeight,
        constraints->fontScale,
        constraints->direction == sizing::Direction::RightToLeft ? " rtl" : "",
        size->width,
        size->height,
        result ? "posted" : measurer_.gaveUp() ? "gave up" : "held");

    if (measurer_.gaveUp()) {
      char line[160];

      std::snprintf(
          line,
          sizeof line,
          "[lucent] view %d stopped sizing to its content after %d results: its size and its layout's constraints "
          "keep changing each other",
          tag_,
          sizing::Measurer::kMaxUnsettledPosts);
      logError(line);
    }

    if (!result) return;

    auto scale = measurer_.scale();
    auto tag = tag_;
    auto judged = std::make_shared<std::atomic<bool>>(false);

    lastPost_ = Post{*result, judged};

    // Judged against the state current when the renderer applies it, on its thread.
    auto update = [result = *result, scale, tag, judged](const SizeStateData& current) -> facebook::react::StateData::Shared {
      auto verdict = sizing::judge(current, result, scale);

      judged->store(true, std::memory_order_release);

      traceSizing(
          "%d result rev %llu under %gx%g: %s",
          tag,
          static_cast<unsigned long long>(result.revision),
          result.constraints.maxWidth,
          result.constraints.maxHeight,
          sizing::verdictName(verdict));

      if (verdict != sizing::Verdict::Accepted) return nullptr;

      auto next = current;

      next.measured = result;

      return std::make_shared<const SizeStateData>(std::move(next));
    };

    state_->updateState(std::move(update));
  }

 private:
  /// A result posted, and whether the renderer has judged it (its thread sets it).
  struct Post {
    sizing::Measurement measurement;
    std::shared_ptr<std::atomic<bool>> judged;
  };

  std::shared_ptr<const State> state_;
  sizing::Measurer measurer_;
  std::optional<Post> lastPost_;
  Measure measure_;
  std::shared_ptr<ui::Content> content_;
  int tag_ = 0;
};

}  // namespace lucent::views
