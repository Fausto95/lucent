// Lucent runtime — the layout core (T50): a tree of React Native's own
// Yoga nodes (no second Yoga ABI), styled by React Native's names and
// values, its leaves measured by a function the platform gives.
//
// Plain data in, frames out: no views, no threads, no reactive graph. A
// `Flex` (ui_flex.h) keeps one node for itself and one per child, and
// applies the frames this computes. Header-only, so that only code using
// it needs Yoga's headers and symbols (React Native's, in an app).
//
// - A key is React Native's (`flexDirection`, `marginStart`, `rowGap`);
//   a value a number (points), a percent (`"50%"`), `"auto"` where the
//   key takes it, or an enum's name (`"space-between"`). Undefined
//   restores the key's default (React Native's). Anything else throws.
// - A node is in one parent at a time: inserting a node that has one
//   throws (remove it first). A parent gone first leaves its children
//   whole, each its own root.
// - Only a root computes; a leaf (a node with a measure function) keeps
//   its measurement until it is marked dirty.
#pragma once

#include <yoga/Yoga.h>

#include <algorithm>
#include <cmath>
#include <cstdlib>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <stdexcept>
#include <string>
#include <string_view>
#include <variant>
#include <vector>

#include "jsstring.h"

namespace lucent::ui {

/// A style value: undefined (the default), a number of points, or a string
/// (a percent, `"auto"`, an enum's name).
using LayoutValue = std::variant<std::monostate, double, String>;

enum class MeasureMode { Undefined, Exactly, AtMost };
enum class LayoutDirection { LTR, RTL };

struct LayoutSize {
  float width = 0;
  float height = 0;
};

/// Where a node is, in its parent's coordinates.
struct LayoutFrame {
  float x = 0;
  float y = 0;
  float width = 0;
  float height = 0;
};

/// A leaf's size under the width and height offered (NaN: none), each
/// with how it binds.
using LayoutMeasure = std::function<LayoutSize(float width, MeasureMode, float height, MeasureMode)>;

namespace layout_detail {

using Setter = std::function<void(YGNodeRef, const LayoutValue&, std::string_view key)>;

[[noreturn]] inline void refuse(std::string_view key, std::string_view what) {
  throw std::invalid_argument(std::string(key) + " takes " + std::string(what));
}

inline std::string text(const LayoutValue& v) { return std::get<String>(v).toUtf8(); }

inline float number(const LayoutValue& v, std::string_view key) {
  if (!std::holds_alternative<double>(v)) refuse(key, "a number");
  return static_cast<float>(std::get<double>(v));
}

/// `"50%"`'s 50; none for any other string.
inline std::optional<float> percent(const std::string& s) {
  if (s.size() < 2 || s.back() != '%') return std::nullopt;

  const std::string digits = s.substr(0, s.size() - 1);
  char* end = nullptr;
  const double v = std::strtod(digits.c_str(), &end);
  if (end != digits.c_str() + digits.size() || !std::isfinite(v)) return std::nullopt;

  return static_cast<float>(v);
}

/// A length's setters: points, percent, and auto where the key takes it.
struct Length {
  std::function<void(YGNodeRef, float)> points;
  std::function<void(YGNodeRef, float)> percent;
  std::function<void(YGNodeRef)> automatic;
  /// Restores the default.
  std::function<void(YGNodeRef)> reset;
};

inline Setter length(Length l) {
  return [l](YGNodeRef n, const LayoutValue& v, std::string_view key) {
    if (std::holds_alternative<std::monostate>(v)) return l.reset(n);
    if (std::holds_alternative<double>(v)) return l.points(n, static_cast<float>(std::get<double>(v)));

    const std::string s = text(v);
    if (auto p = percent(s)) return l.percent(n, *p);
    if (s == "auto" && l.automatic) return l.automatic(n);

    refuse(key, "no " + s);
  };
}

/// An edge's length (margin, padding, position): `auto` where `automatic`.
template <class Points, class Percent>
Setter edge(YGEdge e, Points points, Percent pct, void (*automatic)(YGNodeRef, YGEdge)) {
  return length({
      [=](YGNodeRef n, float v) { points(n, e, v); },
      [=](YGNodeRef n, float v) { pct(n, e, v); },
      automatic ? std::function<void(YGNodeRef)>([=](YGNodeRef n) { automatic(n, e); }) : nullptr,
      [=](YGNodeRef n) { points(n, e, YGUndefined); },
  });
}

/// A plain number (flexGrow), `fallback` when undefined.
inline Setter plain(void (*set)(YGNodeRef, float), float fallback) {
  return [=](YGNodeRef n, const LayoutValue& v, std::string_view key) {
    set(n, std::holds_alternative<std::monostate>(v) ? fallback : number(v, key));
  };
}

/// An enum by React Native's names, the first one its default.
template <class E>
Setter keyword(void (*set)(YGNodeRef, E), std::vector<std::pair<const char*, E>> names) {
  return [=](YGNodeRef n, const LayoutValue& v, std::string_view key) {
    if (std::holds_alternative<std::monostate>(v)) return set(n, names.front().second);
    if (!std::holds_alternative<String>(v)) refuse(key, "a name");

    const std::string s = text(v);
    for (auto& [name, value] : names)
      if (s == name) return set(n, value);

    refuse(key, "no " + s);
  };
}

/// Every key, and how it is set: React Native's layout style.
inline const std::map<std::string, Setter, std::less<>>& rules() {
  static const auto* table = [] {
    auto* t = new std::map<std::string, Setter, std::less<>>();
    auto& r = *t;

    const std::vector<std::pair<const char*, YGAlign>> align = {
        {"flex-start", YGAlignFlexStart},       {"center", YGAlignCenter},
        {"flex-end", YGAlignFlexEnd},           {"stretch", YGAlignStretch},
        {"baseline", YGAlignBaseline},          {"space-between", YGAlignSpaceBetween},
        {"space-around", YGAlignSpaceAround},   {"space-evenly", YGAlignSpaceEvenly},
        {"auto", YGAlignAuto},
    };
    auto startingWith = [&](const char* first) {
      auto out = align;
      std::stable_partition(out.begin(), out.end(), [&](auto& p) { return std::string_view(p.first) == first; });
      return out;
    };

    r["direction"] = keyword<YGDirection>(
        YGNodeStyleSetDirection, {{"inherit", YGDirectionInherit}, {"ltr", YGDirectionLTR}, {"rtl", YGDirectionRTL}});
    r["flexDirection"] = keyword<YGFlexDirection>(YGNodeStyleSetFlexDirection,
                                                  {{"column", YGFlexDirectionColumn},
                                                   {"column-reverse", YGFlexDirectionColumnReverse},
                                                   {"row", YGFlexDirectionRow},
                                                   {"row-reverse", YGFlexDirectionRowReverse}});
    r["justifyContent"] = keyword<YGJustify>(YGNodeStyleSetJustifyContent,
                                             {{"flex-start", YGJustifyFlexStart},
                                              {"center", YGJustifyCenter},
                                              {"flex-end", YGJustifyFlexEnd},
                                              {"space-between", YGJustifySpaceBetween},
                                              {"space-around", YGJustifySpaceAround},
                                              {"space-evenly", YGJustifySpaceEvenly}});
    r["alignItems"] = keyword<YGAlign>(YGNodeStyleSetAlignItems, startingWith("stretch"));
    r["alignSelf"] = keyword<YGAlign>(YGNodeStyleSetAlignSelf, startingWith("auto"));
    r["alignContent"] = keyword<YGAlign>(YGNodeStyleSetAlignContent, startingWith("flex-start"));
    r["flexWrap"] = keyword<YGWrap>(YGNodeStyleSetFlexWrap,
                                    {{"nowrap", YGWrapNoWrap}, {"wrap", YGWrapWrap}, {"wrap-reverse", YGWrapWrapReverse}});
    r["position"] = keyword<YGPositionType>(
        YGNodeStyleSetPositionType,
        {{"relative", YGPositionTypeRelative}, {"absolute", YGPositionTypeAbsolute}, {"static", YGPositionTypeStatic}});
    r["display"] = keyword<YGDisplay>(YGNodeStyleSetDisplay,
                                      {{"flex", YGDisplayFlex}, {"none", YGDisplayNone}, {"contents", YGDisplayContents}});
    r["overflow"] = keyword<YGOverflow>(
        YGNodeStyleSetOverflow, {{"visible", YGOverflowVisible}, {"hidden", YGOverflowHidden}, {"scroll", YGOverflowScroll}});

    r["flex"] = plain(YGNodeStyleSetFlex, YGUndefined);
    r["flexGrow"] = plain(YGNodeStyleSetFlexGrow, 0);
    r["flexShrink"] = plain(YGNodeStyleSetFlexShrink, 0);
    r["aspectRatio"] = plain(YGNodeStyleSetAspectRatio, YGUndefined);

    r["flexBasis"] = length({YGNodeStyleSetFlexBasis, YGNodeStyleSetFlexBasisPercent, YGNodeStyleSetFlexBasisAuto,
                             YGNodeStyleSetFlexBasisAuto});
    r["width"] = length({YGNodeStyleSetWidth, YGNodeStyleSetWidthPercent, YGNodeStyleSetWidthAuto, YGNodeStyleSetWidthAuto});
    r["height"] =
        length({YGNodeStyleSetHeight, YGNodeStyleSetHeightPercent, YGNodeStyleSetHeightAuto, YGNodeStyleSetHeightAuto});

    auto bound = [](void (*points)(YGNodeRef, float), void (*pct)(YGNodeRef, float)) {
      return length({points, pct, nullptr, [points](YGNodeRef n) { points(n, YGUndefined); }});
    };
    r["minWidth"] = bound(YGNodeStyleSetMinWidth, YGNodeStyleSetMinWidthPercent);
    r["maxWidth"] = bound(YGNodeStyleSetMaxWidth, YGNodeStyleSetMaxWidthPercent);
    r["minHeight"] = bound(YGNodeStyleSetMinHeight, YGNodeStyleSetMinHeightPercent);
    r["maxHeight"] = bound(YGNodeStyleSetMaxHeight, YGNodeStyleSetMaxHeightPercent);

    const std::vector<std::pair<const char*, YGEdge>> edges = {
        {"", YGEdgeAll},           {"Horizontal", YGEdgeHorizontal}, {"Vertical", YGEdgeVertical},
        {"Top", YGEdgeTop},        {"Right", YGEdgeRight},           {"Bottom", YGEdgeBottom},
        {"Left", YGEdgeLeft},      {"Start", YGEdgeStart},           {"End", YGEdgeEnd},
    };
    for (auto& [suffix, e] : edges) {
      r[std::string("margin") + suffix] = edge(e, YGNodeStyleSetMargin, YGNodeStyleSetMarginPercent, YGNodeStyleSetMarginAuto);
      r[std::string("padding") + suffix] = edge(e, YGNodeStyleSetPadding, YGNodeStyleSetPaddingPercent, nullptr);
    }

    const std::vector<std::pair<const char*, YGEdge>> insets = {
        {"top", YGEdgeTop}, {"right", YGEdgeRight}, {"bottom", YGEdgeBottom},
        {"left", YGEdgeLeft}, {"start", YGEdgeStart}, {"end", YGEdgeEnd},
    };
    for (auto& [name, e] : insets)
      r[name] = edge(e, YGNodeStyleSetPosition, YGNodeStyleSetPositionPercent, YGNodeStyleSetPositionAuto);

    const std::vector<std::pair<const char*, YGGutter>> gaps = {
        {"gap", YGGutterAll}, {"rowGap", YGGutterRow}, {"columnGap", YGGutterColumn}};
    for (auto& [name, g] : gaps)
      r[name] = length({
          [g](YGNodeRef n, float v) { YGNodeStyleSetGap(n, g, v); },
          [g](YGNodeRef n, float v) { YGNodeStyleSetGapPercent(n, g, v); },
          nullptr,
          [g](YGNodeRef n) { YGNodeStyleSetGap(n, g, YGUndefined); },
      });

    return t;
  }();

  return *table;
}

inline MeasureMode modeOf(YGMeasureMode m) {
  switch (m) {
    case YGMeasureModeExactly: return MeasureMode::Exactly;
    case YGMeasureModeAtMost: return MeasureMode::AtMost;
    default: return MeasureMode::Undefined;
  }
}

}  // namespace layout_detail

/// A node of a layout tree.
class LayoutNode {
 public:
  static std::shared_ptr<LayoutNode> create() { return std::shared_ptr<LayoutNode>(new LayoutNode()); }

  LayoutNode(const LayoutNode&) = delete;
  LayoutNode& operator=(const LayoutNode&) = delete;

  ~LayoutNode() {
    YGNodeRemoveAllChildren(node_);
    for (auto& c : children_) c->parent_ = nullptr;

    YGNodeFree(node_);
    YGConfigFree(config_);
  }

  /// Sets React Native's style `key` to `value`; undefined restores its default.
  void set(std::string_view key, const LayoutValue& value) {
    const auto& rules = layout_detail::rules();
    auto rule = rules.find(key);
    if (rule == rules.end()) throw std::invalid_argument("no layout key " + std::string(key));

    rule->second(node_, value, key);
  }

  /// Makes the node a leaf that `measure` sizes.
  void measureWith(LayoutMeasure measure) {
    measure_ = std::move(measure);
    YGNodeSetMeasureFunc(node_, &LayoutNode::measured);
  }

  /// Inserts `child`, which has no parent, at `index` among the children.
  void insert(const std::shared_ptr<LayoutNode>& child, size_t index) {
    if (child->parent_) throw std::logic_error("a layout node is in one parent at a time");
    if (index > children_.size()) throw std::out_of_range("no child at that index");

    YGNodeInsertChild(node_, child->node_, index);
    children_.insert(children_.begin() + static_cast<long>(index), child);
    child->parent_ = this;
    child->setPointScale(scale_);
  }

  void remove(const std::shared_ptr<LayoutNode>& child) {
    auto at = std::find(children_.begin(), children_.end(), child);
    if (at == children_.end()) return;

    YGNodeRemoveChild(node_, child->node_);
    child->parent_ = nullptr;
    children_.erase(at);
  }

  LayoutNode* parent() const { return parent_; }
  const std::vector<std::shared_ptr<LayoutNode>>& children() const { return children_; }

  /// Marks every leaf of the tree under this node for measuring again.
  void dirtyLeaves() {
    if (measure_) YGNodeMarkDirty(node_);
    for (auto& c : children_) c->dirtyLeaves();
  }

  /// Rounds frames to the pixel grid of `scale` pixels a point (0: none), here and below.
  void setPointScale(float scale) {
    scale_ = scale;
    YGConfigSetPointScaleFactor(config_, scale);
    for (auto& c : children_) c->setPointScale(scale);
  }

  /// Lays out the tree this node is the root of, in `width` by `height` (NaN: unbounded).
  void calculate(float width, float height, LayoutDirection direction) {
    if (parent_) throw std::logic_error("only a layout tree's root lays it out");

    YGNodeCalculateLayout(node_, width, height, direction == LayoutDirection::RTL ? YGDirectionRTL : YGDirectionLTR);
  }

  LayoutFrame frame() const {
    return {YGNodeLayoutGetLeft(node_), YGNodeLayoutGetTop(node_), YGNodeLayoutGetWidth(node_),
            YGNodeLayoutGetHeight(node_)};
  }

 private:
  LayoutNode() : config_(YGConfigNew()), node_(YGNodeNewWithConfig(config_)) {
    YGNodeSetContext(node_, this);
  }

  static YGSize measured(YGNodeConstRef node, float width, YGMeasureMode wm, float height, YGMeasureMode hm) {
    auto* self = static_cast<LayoutNode*>(YGNodeGetContext(node));
    const LayoutSize s = self->measure_(width, layout_detail::modeOf(wm), height, layout_detail::modeOf(hm));
    return {s.width, s.height};
  }

  YGConfigRef config_;
  YGNodeRef node_;
  LayoutNode* parent_ = nullptr;
  std::vector<std::shared_ptr<LayoutNode>> children_;
  LayoutMeasure measure_;
  float scale_ = 0;
};

}  // namespace lucent::ui
