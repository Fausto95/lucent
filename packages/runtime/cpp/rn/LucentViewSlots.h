// Lucent runtime — how Fabric lays out a Lucent component taking React
// children (a `children: Children` prop, lucent:ui's slot), in its slot's
// rectangle (lucent/slots.h has the exchange itself).
//
// Its shadow node is a Yoga container, as a View's is: Yoga sizes it by its
// style, flex and children, and lays the children out in its own
// coordinates. Its host never measures its content (the node is no
// measurable leaf, so its state never asks for a size), and mounts each
// child React Native gives it in the slot its setup placed, where the child
// shows at the frame Yoga gave it.
//
// Where the children go: the host reports, from the main thread, how far
// the slot lies in from each edge of the component's content box (HostSlot),
// as a state update the renderer applies on its own thread if it is newer
// and moves the children. The shadow node then has Yoga lay its children
// out as if its border were wider by those insets: a child that fills its
// parent fills the slot, and a card sized by its children grows by what
// its native views take around the slot. Before the first report the
// children lay out in the content box, which a slot filling its view (the
// default) needs no report to match. The wider border stays the node's
// own: the host's layout metrics keep the style's border and padding, so
// the setup's view stays in the real content box.
#pragma once

#include <react/renderer/components/view/ConcreteViewShadowNode.h>
#include <react/renderer/core/LayoutContext.h>

#include <lucent/slots.h>

#include "LucentViewSizing.h"

#include <memory>
#include <optional>
#include <utility>

namespace lucent::views {

/// The border widths `style` sets, edge by edge.
inline slots::BorderEdges borderEdges(const facebook::yoga::Style& style) {
  using facebook::yoga::Edge;

  // A width not in points resolves to none, as Yoga resolves it, and still takes precedence.
  auto edge = [&](Edge e) -> std::optional<float> {
    auto length = style.border(e);

    if (!length.isDefined()) return std::nullopt;

    return length.isPoints() ? length.value().unwrap() : 0.0f;
  };

  return {
      edge(Edge::All),
      edge(Edge::Horizontal),
      edge(Edge::Vertical),
      edge(Edge::Left),
      edge(Edge::Top),
      edge(Edge::Right),
      edge(Edge::Bottom),
      edge(Edge::Start),
      edge(Edge::End),
  };
}

/**
 * A component's shadow node when it takes React children: a Yoga container
 * laying them out in its slot, once its host has reported where that is.
 * Its state is a leaf's (SizeStateData), so both kinds share their hosts'
 * code; nothing asks it for a measurement.
 */
template <const char* Name, typename PropsT, typename EmitterT>
class SlotShadowNode final
    : public facebook::react::ConcreteViewShadowNode<Name, PropsT, EmitterT, SizeStateData> {
  using Base = facebook::react::ConcreteViewShadowNode<Name, PropsT, EmitterT, SizeStateData>;

 public:
  SlotShadowNode(
      const facebook::react::ShadowNodeFragment& fragment,
      const facebook::react::ShadowNodeFamily::Shared& family,
      facebook::react::ShadowNodeTraits traits)
      : Base(fragment, family, traits) {
    placeChildren();
  }

  SlotShadowNode(const facebook::react::ShadowNode& source, const facebook::react::ShadowNodeFragment& fragment)
      : Base(source, fragment) {
    placeChildren();
  }

  /// Laid out: the host sees the style's own border and content box, never the slot's insets.
  void layout(facebook::react::LayoutContext context) override {
    Base::layout(context);

    if (!this->getStateData().slot) return;

    auto metrics = this->getLayoutMetrics();
    auto border = slots::resolve(
        borderEdges(this->getConcreteProps().yogaStyle),
        metrics.layoutDirection == facebook::react::LayoutDirection::RightToLeft,
        metrics.wasLeftAndRightSwapped);
    auto& insets = metrics.contentInsets;
    auto& width = metrics.borderWidth;

    insets = {
        insets.left - width.left + border.left,
        insets.top - width.top + border.top,
        insets.right - width.right + border.right,
        insets.bottom - width.bottom + border.bottom,
    };
    width = {border.left, border.top, border.right, border.bottom};
    this->setLayoutMetrics(metrics);
  }

 private:
  /**
   * The Yoga style: the props' border widened by the slot's insets, as the
   * host last reported them. Written as start and end (the report's
   * direction says which is left), which React Native's left-and-right
   * swap leaves alone. Untouched before the first report.
   */
  void placeChildren() {
    using facebook::yoga::Edge;
    using facebook::yoga::StyleLength;

    const auto& slot = this->getStateData().slot;

    if (!slot) return;

    auto border = slots::resolve(borderEdges(this->getConcreteProps().yogaStyle), slot->rtl, slot->swapped);
    const auto& in = slot->insets;
    float left = border.left + in.left;
    float right = border.right + in.right;
    auto style = this->yogaNode_.style();

    for (auto edge : {Edge::All, Edge::Horizontal, Edge::Vertical, Edge::Left, Edge::Right})
      style.setBorder(edge, StyleLength::undefined());

    style.setBorder(Edge::Top, StyleLength::points(border.top + in.top));
    style.setBorder(Edge::Bottom, StyleLength::points(border.bottom + in.bottom));
    style.setBorder(Edge::Start, StyleLength::points(slot->rtl ? right : left));
    style.setBorder(Edge::End, StyleLength::points(slot->rtl ? left : right));

    if (style == this->yogaNode_.style()) return;

    this->yogaNode_.setStyle(style);
    this->yogaNode_.setDirty(true);
  }
};

/**
 * A host's side of its slot's place, for one mount (main thread): the
 * state of the latest commit it mounted, where it last measured the slot,
 * and its Reporter. The host tells it where the slot is after each layout
 * of the slot, and when the mount's native views changed; it posts what
 * the shadow tree lacks.
 */
class HostSlot {
 public:
  using State = facebook::react::ConcreteState<SizeStateData>;

  HostSlot() = default;

  /// A mount starts on the view `tag` names, at `scale` pixels per point.
  void start(float scale, int tag) {
    reporter_ = slots::Reporter(scale);
    measured_.reset();
    tag_ = tag;
  }

  /// The state of the commit being mounted.
  void setState(const facebook::react::State::Shared& state) {
    state_ = std::static_pointer_cast<const State>(state);
    report();
  }

  /// The mount's native views changed (a commit, a command): reports go again, past the bound.
  void contentChanged() {
    reporter_.contentChanged();
    report();
  }

  /// The slot lies `insets` in from the content box, the component laid out as `rtl` and `swapped` say.
  void place(slots::Insets insets, bool rtl, bool swapped) {
    measured_ = Measured{insets, rtl, swapped};
    report();
  }

 private:
  struct Measured {
    slots::Insets insets;
    bool rtl;
    bool swapped;
  };

  /// Posts where the slot was last measured, if the shadow tree lacks it.
  void report() {
    if (!state_ || !measured_) return;

    bool gaveUp = reporter_.gaveUp();
    auto posted = reporter_.record(state_->getData().slot, measured_->insets, measured_->rtl, measured_->swapped);

    if (!posted) {
      if (!gaveUp && reporter_.gaveUp()) traceSizing("%d slot gave up", tag_);

      return;
    }

    traceSizing(
        "%d slot report %llu: %g,%g,%g,%g%s posted",
        tag_,
        static_cast<unsigned long long>(posted->revision),
        posted->insets.left,
        posted->insets.top,
        posted->insets.right,
        posted->insets.bottom,
        posted->rtl ? " rtl" : "");

    auto scale = reporter_.scale();
    auto tag = tag_;

    // Judged against the state current when the renderer applies it, on its thread.
    state_->updateState([report = *posted, scale, tag](const SizeStateData& current) -> facebook::react::StateData::Shared {
      auto verdict = slots::judge(current.slot, report, scale);

      traceSizing("%d slot result %llu: %s", tag, static_cast<unsigned long long>(report.revision), slots::verdictName(verdict));

      if (verdict != slots::Verdict::Accepted) return nullptr;

      auto next = current;

      next.slot = report;

      return std::make_shared<const SizeStateData>(std::move(next));
    });
  }

  std::shared_ptr<const State> state_;
  slots::Reporter reporter_;
  std::optional<Measured> measured_;
  int tag_ = 0;
};

}  // namespace lucent::views
