// Lucent runtime — where a component lays out its React children: in its
// slot's rectangle.
//
// The slot is a platform view the component's setup places anywhere in its
// native views, which only the main thread may measure; the renderer lays
// React's children out on its own thread. So the host reports where the
// slot is rather than being asked: the slot's insets in the component's
// content box (its frame less border and padding), measured on the main
// thread and posted to the component's shadow tree, which takes a report
// only if it is newer and moves the children (judge). Yoga then lays the
// children out as if the component's border were wider by the insets. The
// shadow side never waits for the main thread.
//
// Plain data and arithmetic: the React Native side (rn/LucentViewSlots.h)
// keeps a Placement in a component's state, and the platform hosts drive a
// Reporter.
#pragma once

#include <algorithm>
#include <cmath>
#include <cstdint>
#include <initializer_list>
#include <optional>

namespace lucent::slots {

/// Distances in points (Android: density-independent pixels) in from each
/// edge of a box, as the screen shows them: left is left in either direction.
struct Insets {
  float left = 0;
  float top = 0;
  float right = 0;
  float bottom = 0;

  friend bool operator==(const Insets&, const Insets&) = default;
};

/// A rectangle, in points.
struct Rect {
  float x = 0;
  float y = 0;
  float width = 0;
  float height = 0;
};

/// How far `slot` lies in from each edge of `content` (both in the host's
/// coordinates); nothing on an edge where the slot reaches past the box.
inline Insets insetsOf(const Rect& slot, const Rect& content) {
  auto in = [](float distance) { return std::max(distance, 0.0f); };

  return {
      in(slot.x - content.x),
      in(slot.y - content.y),
      in(content.x + content.width - (slot.x + slot.width)),
      in(content.y + content.height - (slot.y + slot.height)),
  };
}

/// `points` to the nearest physical pixel at `scale` pixels per point.
inline float snap(float points, float scale) { return std::round(points * scale) / scale; }

inline Insets snap(const Insets& insets, float scale) {
  return {snap(insets.left, scale), snap(insets.top, scale), snap(insets.right, scale), snap(insets.bottom, scale)};
}

/// Within a physical pixel of each other on every edge: what layout cannot tell apart.
inline bool same(const Insets& a, const Insets& b, float scale) {
  auto near = [scale](float x, float y) { return std::fabs(x - y) < 1 / scale; };

  return near(a.left, b.left) && near(a.top, b.top) && near(a.right, b.right) && near(a.bottom, b.bottom);
}

/// The slot fills the content box.
inline bool none(const Insets& insets, float scale) { return same(insets, Insets{}, scale); }

/**
 * A host's report, as the shadow tree keeps it: the slot's insets, and the
 * direction the component laid out in when the host measured them, which
 * says what its style's edges mean.
 */
struct Placement {
  /// The host's count of reports for this mount, from 1.
  std::uint64_t revision = 0;
  Insets insets;
  /// The component laid out right to left.
  bool rtl = false;
  /// Its style's left and right edges meant start and end (React Native's
  /// swapLeftAndRightInRTL).
  bool swapped = false;
};

/// Whether a shadow tree holding `held` (none: no report yet) lays its
/// children out as `report` would have it.
inline bool holds(const std::optional<Placement>& held, const Placement& report, float scale) {
  auto insets = held ? held->insets : Insets{};

  if (!same(insets, report.insets, scale)) return false;

  return none(report.insets, scale) || (held && held->rtl == report.rtl && held->swapped == report.swapped);
}

enum class Verdict {
  /// The shadow tree takes it.
  Accepted,
  /// The shadow tree holds a newer report.
  StaleRevision,
  /// The shadow tree lays its children out there already.
  Unchanged,
};

inline const char* verdictName(Verdict verdict) {
  switch (verdict) {
    case Verdict::Accepted:
      return "accepted";
    case Verdict::StaleRevision:
      return "stale revision";
    case Verdict::Unchanged:
      return "unchanged";
  }

  return "?";
}

/// Whether the shadow tree, holding `held`, takes `report`.
inline Verdict judge(const std::optional<Placement>& held, const Placement& report, float scale) {
  if (held && report.revision < held->revision) return Verdict::StaleRevision;

  return holds(held, report, scale) ? Verdict::Unchanged : Verdict::Accepted;
}

/// A border's widths as a style gives them: each edge's, if it sets one.
struct BorderEdges {
  std::optional<float> all;
  std::optional<float> horizontal;
  std::optional<float> vertical;
  std::optional<float> left;
  std::optional<float> top;
  std::optional<float> right;
  std::optional<float> bottom;
  std::optional<float> start;
  std::optional<float> end;
};

/// The width layout gives each side of a border set by `edges`, laid out
/// right to left if `rtl`, with left and right meaning start and end if
/// `swapped`: Yoga's precedence, none negative.
inline Insets resolve(const BorderEdges& edges, bool rtl, bool swapped) {
  auto first = [](std::initializer_list<std::optional<float>> candidates) {
    for (const auto& candidate : candidates)
      if (candidate) return std::max(*candidate, 0.0f);

    return 0.0f;
  };

  // React Native's swap turns a style's left and right into start and end.
  auto start = swapped && edges.left ? edges.left : edges.start;
  auto end = swapped && edges.right ? edges.right : edges.end;
  auto left = swapped ? std::nullopt : edges.left;
  auto right = swapped ? std::nullopt : edges.right;

  return {
      first({rtl ? end : start, left, edges.horizontal, edges.all}),
      first({edges.top, edges.vertical, edges.all}),
      first({rtl ? start : end, right, edges.horizontal, edges.all}),
      first({edges.bottom, edges.vertical, edges.all}),
  };
}

/**
 * The host's side, for one mount (main thread): what it posted last, its
 * count of reports, and a bound on reports that never settle, so that a
 * slot whose place follows the component's size (a fixed slot in a
 * component sized by its children) cannot make layout loop.
 */
class Reporter {
 public:
  /// Reports allowed until the shadow tree holds what the host measures,
  /// or the mount's native views change.
  static constexpr int kMaxUnsettledPosts = 3;

  explicit Reporter(float scale = 1) : scale_(scale) {}

  float scale() const { return scale_; }

  /// The mount's native views changed (a commit, a command): report again.
  void contentChanged() {
    unsettled_ = 0;
    gaveUp_ = false;
    pending_.reset();
  }

  /// The slot measured at `insets` (the component laid out as `rtl` and
  /// `swapped` say) while the shadow tree holds `held`: the report to
  /// post, unless the shadow tree holds it already, it is posted already,
  /// or the bound is reached.
  std::optional<Placement> record(const std::optional<Placement>& held, Insets insets, bool rtl, bool swapped) {
    Placement report{revision_ + 1, snap(insets, scale_), rtl, swapped};

    if (holds(held, report, scale_)) {
      unsettled_ = 0;
      gaveUp_ = false;
      pending_.reset();
      return std::nullopt;
    }

    if (pending_ && holds(pending_, report, scale_)) return std::nullopt;

    if (unsettled_ >= kMaxUnsettledPosts) {
      gaveUp_ = true;
      return std::nullopt;
    }

    ++unsettled_;
    revision_ = report.revision;
    pending_ = report;

    return report;
  }

  /// Whether the bound stopped reporting (until the shadow tree settles or the native views change).
  bool gaveUp() const { return gaveUp_; }

 private:
  float scale_;
  std::uint64_t revision_ = 0;
  std::optional<Placement> pending_;
  int unsettled_ = 0;
  bool gaveUp_ = false;
};

}  // namespace lucent::slots
