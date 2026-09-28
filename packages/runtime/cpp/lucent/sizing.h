// Lucent runtime — how a component's host sizes to its content.
//
// The renderer lays React's tree out on its own thread; a component's
// content is a platform view, which only the main thread may measure. So
// the two exchange results rather than calls: the shadow tree records the
// constraints its layout asks for (a SizeState's `requested`) when the
// measurement it holds does not answer them (request), the host measures
// its content under them on the main thread and posts the result, tagged
// with the constraints it used and the content's revision, and the shadow
// tree takes it only if it is still current (judge). The shadow side never
// waits for the main thread.
//
// A measurement answers the constraints it was made under (bounds, font
// scale, direction) and stricter bounds the size still fits within: the
// content's measure is assumed monotonic, as Yoga's measure cache assumes.
//
// Plain data and arithmetic: the React Native side (rn/LucentViewSizing.h)
// keeps a SizeState as a shadow node's state, and the platform hosts drive
// a Measurer.
#pragma once

#include <cmath>
#include <cstdint>
#include <limits>
#include <optional>

namespace lucent::sizing {

/// No bound on an axis.
inline constexpr float kUnbounded = std::numeric_limits<float>::infinity();

/// A size in points (Android: density-independent pixels).
struct Size {
  float width = 0;
  float height = 0;

  friend bool operator==(const Size&, const Size&) = default;
};

enum class Direction : std::uint8_t { LeftToRight, RightToLeft };

/// What a layout measures the content under: the largest size it offers
/// per axis, the text size multiplier it lays text out with (Dynamic Type,
/// Android's font scale) and its direction.
struct Constraints {
  float maxWidth = kUnbounded;
  float maxHeight = kUnbounded;
  float fontScale = 1;
  Direction direction = Direction::LeftToRight;

  friend bool operator==(const Constraints&, const Constraints&) = default;
};

/// The content's size under `constraints`, at content revision `revision`.
struct Measurement {
  std::uint64_t revision = 0;
  Constraints constraints;
  Size size;
};

/// What the shadow tree holds: the constraints its latest layout asked
/// for, and the measurement it sizes the content with.
struct SizeState {
  std::optional<Constraints> requested;
  std::optional<Measurement> measured;
};

/// `points` up to the next physical pixel at `scale` pixels per point,
/// ignoring a float's rounding error: a measured size must not cut the
/// content. An unbounded value stays so; none goes below zero.
inline float snap(float points, float scale) {
  if (std::isinf(points)) return points;

  auto snapped = std::ceil(points * scale - 1e-3f) / scale;

  // Not -0, which 0 less the slack rounds up to.
  return snapped > 0 ? snapped : 0.0f;
}

inline Size snap(Size size, float scale) { return {snap(size.width, scale), snap(size.height, scale)}; }

/// Within a physical pixel of each other: what layout cannot tell apart.
inline bool same(float a, float b, float scale) {
  if (std::isinf(a) || std::isinf(b)) return a == b;

  return std::fabs(a - b) < 1 / scale;
}

inline bool same(const Size& a, const Size& b, float scale) {
  return same(a.width, b.width, scale) && same(a.height, b.height, scale);
}

inline bool same(const Constraints& a, const Constraints& b, float scale) {
  return same(a.maxWidth, b.maxWidth, scale) && same(a.maxHeight, b.maxHeight, scale) &&
         a.fontScale == b.fontScale && a.direction == b.direction;
}

/// Whether content measured at `size` under `measuredBound` has that size
/// under `bound` too: the same bound, or a stricter one it still fits
/// within. A looser bound may not: the old one may have cut the content
/// (wrapped its text). Yoga's measure cache relies on the same rule.
inline bool fits(float size, float measuredBound, float bound, float scale) {
  if (same(measuredBound, bound, scale)) return true;

  return bound < measuredBound && (size < bound || same(size, bound, scale));
}

/// Whether `measurement` gives the content's size under `constraints`.
inline bool answers(const Measurement& measurement, const Constraints& constraints, float scale) {
  const auto& measured = measurement.constraints;

  return measured.fontScale == constraints.fontScale && measured.direction == constraints.direction &&
         fits(measurement.size.width, measured.maxWidth, constraints.maxWidth, scale) &&
         fits(measurement.size.height, measured.maxHeight, constraints.maxHeight, scale);
}

enum class Verdict {
  /// The shadow tree takes it.
  Accepted,
  /// The shadow tree holds a measurement of newer content.
  StaleRevision,
  /// Measured under constraints the layout no longer asks for.
  StaleConstraints,
  /// The shadow tree holds this size already: nothing to lay out again.
  Unchanged,
};

inline const char* verdictName(Verdict verdict) {
  switch (verdict) {
    case Verdict::Accepted:
      return "accepted";
    case Verdict::StaleRevision:
      return "stale revision";
    case Verdict::StaleConstraints:
      return "stale constraints";
    case Verdict::Unchanged:
      return "unchanged";
  }

  return "?";
}

/// Whether `state`'s measurement gives the size for the constraints it asks for.
inline bool settled(const SizeState& state, float scale) {
  return state.requested && state.measured && answers(*state.measured, *state.requested, scale);
}

/// Whether the shadow tree, holding `state`, takes `measurement`.
inline Verdict judge(const SizeState& state, const Measurement& measurement, float scale) {
  if (state.measured && measurement.revision < state.measured->revision) return Verdict::StaleRevision;

  if (!state.requested || !answers(measurement, *state.requested, scale)) return Verdict::StaleConstraints;

  if (settled(state, scale) && same(state.measured->size, measurement.size, scale)) return Verdict::Unchanged;

  return Verdict::Accepted;
}

/// What the layout asks the host to measure under, having measured the
/// content under `asked`: nothing if `state` asks for it already, or if
/// its measurement answers it and whatever `state` asks for (a stricter
/// height bound in a column); else `asked`, replacing a pending request.
inline std::optional<Constraints> request(const SizeState& state, const Constraints& asked, float scale) {
  if (state.requested && same(*state.requested, asked, scale)) return std::nullopt;

  if (state.measured && answers(*state.measured, asked, scale) &&
      (!state.requested || answers(*state.measured, *state.requested, scale)))
    return std::nullopt;

  return asked;
}

/// The size the shadow tree lays the content out at: its measurement,
/// even one for other constraints (until the host measures under the new
/// ones), or nothing before the first.
inline Size layoutSize(const SizeState& state) { return state.measured ? state.measured->size : Size{}; }

/**
 * The host's side, for one mount (main thread): the content's revision,
 * what it measured last, and a bound on results whose layout asks for
 * other constraints again, so that content whose size depends on the
 * constraints it gets cannot make layout loop.
 */
class Measurer {
 public:
  /// Posts allowed until the state settles (holds a measurement that
  /// answers the constraints it asks for) or the content changes.
  static constexpr int kMaxUnsettledPosts = 3;

  explicit Measurer(float scale = 1) : scale_(scale) {}

  float scale() const { return scale_; }

  /// The content's revision: 1 at mount, one more for each change.
  std::uint64_t revision() const { return revision_; }

  /// The content changed (a commit, a command, the view itself): measure again.
  void contentChanged() {
    ++revision_;
    unsettled_ = 0;
    gaveUp_ = false;
  }

  /// A state reached the host.
  void observe(const SizeState& state) {
    if (settled(state, scale_)) {
      unsettled_ = 0;
      gaveUp_ = false;
    }
  }

  /// The constraints to measure under now, if `state` asks for any this
  /// revision's last measurement does not answer.
  std::optional<Constraints> due(const SizeState& state) const {
    if (!state.requested || gaveUp_) return std::nullopt;

    if (last_ && last_->revision == revision_ && answers(*last_, *state.requested, scale_)) return std::nullopt;

    return state.requested;
  }

  /// The content measured `size` under `constraints`: the measurement to
  /// post, unless `state` holds it already, `pending` (the last result
  /// posted, while the renderer has not judged it) says the same size
  /// under the same constraints, or the bound is reached.
  std::optional<Measurement> record(
      const SizeState& state,
      Constraints constraints,
      Size size,
      const std::optional<Measurement>& pending = std::nullopt) {
    Measurement measurement{revision_, constraints, snap(size, scale_)};

    last_ = measurement;

    if (state.measured && answers(*state.measured, constraints, scale_) &&
        same(state.measured->size, measurement.size, scale_))
      return std::nullopt;

    if (pending && same(pending->constraints, constraints, scale_) && same(pending->size, measurement.size, scale_))
      return std::nullopt;

    if (unsettled_ >= kMaxUnsettledPosts) {
      gaveUp_ = true;
      return std::nullopt;
    }

    ++unsettled_;

    return measurement;
  }

  /// Whether the bound stopped posting (until the state settles or the content changes).
  bool gaveUp() const { return gaveUp_; }

 private:
  float scale_;
  std::uint64_t revision_ = 1;
  std::optional<Measurement> last_;
  int unsettled_ = 0;
  bool gaveUp_ = false;
};

}  // namespace lucent::sizing
