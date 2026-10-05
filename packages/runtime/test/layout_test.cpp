// Unit tests for the layout core (T50, lucent/layout.h): a tree of Yoga
// nodes, React Native's Yoga, styled by React Native's names and values,
// its leaves measured by a function. Built with Yoga's sources by
// `packages/runtime/test/run.sh`, also under ASan/UBSan.
#include <cmath>
#include <cstdio>
#include <memory>
#include <stdexcept>
#include <string>

#include "lucent/layout.h"

using namespace lucent;
using ui::LayoutNode;
using ui::LayoutValue;

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

static LayoutValue s(const char* text) { return String::fromUtf8(text); }

static bool frameIs(const std::shared_ptr<LayoutNode>& n, float x, float y, float w, float h) {
  auto f = n->frame();
  bool same = std::abs(f.x - x) < 0.01f && std::abs(f.y - y) < 0.01f && std::abs(f.width - w) < 0.01f &&
              std::abs(f.height - h) < 0.01f;
  if (!same) std::fprintf(stderr, "  frame %g %g %g %g, expected %g %g %g %g\n", f.x, f.y, f.width, f.height, x, y, w, h);
  return same;
}

/// A leaf measured as `width` by `height`, whatever it is offered.
static std::shared_ptr<LayoutNode> leaf(float width, float height) {
  auto n = LayoutNode::create();
  n->measureWith([width, height](float, ui::MeasureMode, float, ui::MeasureMode) { return ui::LayoutSize{width, height}; });
  return n;
}

const float none = NAN;

// A row with padding and a gap: a fixed child, one that grows into the rest,
// and a measured one; all stretched to the row's inner height.
static void laysOutARow() {
  auto row = LayoutNode::create();
  row->set("flexDirection", s("row"));
  row->set("width", 300.0);
  row->set("height", 100.0);
  row->set("padding", 10.0);
  row->set("gap", 8.0);

  auto fixed = LayoutNode::create();
  fixed->set("width", 50.0);
  auto grows = LayoutNode::create();
  grows->set("flexGrow", 1.0);
  auto measured = leaf(40, 20);

  row->insert(fixed, 0);
  row->insert(grows, 1);
  row->insert(measured, 2);
  row->calculate(none, none, ui::LayoutDirection::LTR);

  CHECK(frameIs(row, 0, 0, 300, 100));
  CHECK(frameIs(fixed, 10, 10, 50, 80));
  CHECK(frameIs(grows, 68, 10, 174, 80));
  CHECK(frameIs(measured, 250, 10, 40, 80));
}

// A column sized by its content, then under a width it may not exceed: the
// leaf hears the bound.
static void sizesAColumnByItsContent() {
  auto column = LayoutNode::create();
  column->set("gap", 4.0);
  column->set("alignItems", s("flex-start"));

  float offered = -1;
  ui::MeasureMode mode = ui::MeasureMode::Exactly;
  auto text = LayoutNode::create();
  text->measureWith([&](float w, ui::MeasureMode m, float, ui::MeasureMode) {
    offered = w;
    mode = m;
    return ui::LayoutSize{std::isnan(w) ? 100.0f : std::min(w, 100.0f), 20};
  });

  column->insert(text, 0);
  column->insert(leaf(60, 30), 1);

  column->calculate(none, none, ui::LayoutDirection::LTR);
  CHECK(frameIs(column, 0, 0, 100, 54));
  CHECK(mode == ui::MeasureMode::Undefined);

  column->calculate(80, none, ui::LayoutDirection::LTR);
  CHECK(offered == 80);
  CHECK(mode == ui::MeasureMode::AtMost);
  CHECK(frameIs(text, 0, 0, 80, 20));
}

// Percents of the parent, and an automatic margin taking the free space.
static void takesPercentsAndAuto() {
  auto row = LayoutNode::create();
  row->set("flexDirection", s("row"));
  row->set("width", 200.0);
  row->set("height", 50.0);

  auto half = LayoutNode::create();
  half->set("width", s("50%"));
  auto pushed = LayoutNode::create();
  pushed->set("width", 20.0);
  pushed->set("marginLeft", s("auto"));

  row->insert(half, 0);
  row->insert(pushed, 1);
  row->calculate(none, none, ui::LayoutDirection::LTR);

  CHECK(frameIs(half, 0, 0, 100, 50));
  CHECK(frameIs(pushed, 180, 0, 20, 50));
}

// Right to left: a row starts at the right; `start` follows the direction.
static void laysOutRightToLeft() {
  auto row = LayoutNode::create();
  row->set("flexDirection", s("row"));
  row->set("width", 200.0);
  row->set("height", 20.0);
  row->set("paddingStart", 10.0);

  auto a = leaf(50, 20);
  auto b = leaf(50, 20);
  row->insert(a, 0);
  row->insert(b, 1);

  row->calculate(none, none, ui::LayoutDirection::RTL);
  CHECK(frameIs(a, 140, 0, 50, 20));
  CHECK(frameIs(b, 90, 0, 50, 20));

  row->calculate(none, none, ui::LayoutDirection::LTR);
  CHECK(frameIs(a, 10, 0, 50, 20));
}

// A node inside another: one tree, each frame in its parent's coordinates.
static void nestsNodes() {
  auto outer = LayoutNode::create();
  outer->set("flexDirection", s("row"));
  outer->set("padding", 5.0);

  auto inner = LayoutNode::create();
  inner->set("padding", 3.0);
  auto deep = leaf(10, 10);
  inner->insert(deep, 0);
  outer->insert(leaf(20, 30), 0);
  outer->insert(inner, 1);

  outer->calculate(none, none, ui::LayoutDirection::LTR);
  CHECK(frameIs(outer, 0, 0, 46, 40));
  CHECK(frameIs(inner, 25, 5, 16, 30));
  CHECK(frameIs(deep, 3, 3, 10, 10));
  CHECK(inner->parent() == outer.get());
  CHECK(outer->parent() == nullptr);
}

// A leaf keeps its measurement until it is marked dirty.
static void measuresAgainWhenDirty() {
  float width = 30;
  int measured = 0;
  auto text = LayoutNode::create();
  text->measureWith([&](float, ui::MeasureMode, float, ui::MeasureMode) {
    measured++;
    return ui::LayoutSize{width, 10};
  });
  auto row = LayoutNode::create();
  row->set("flexDirection", s("row"));
  row->set("alignItems", s("flex-start"));
  row->insert(text, 0);

  row->calculate(none, none, ui::LayoutDirection::LTR);
  CHECK(frameIs(text, 0, 0, 30, 10));
  const int first = measured;

  width = 70;
  row->calculate(none, none, ui::LayoutDirection::LTR);
  CHECK(frameIs(text, 0, 0, 30, 10));
  CHECK(measured == first);

  row->dirtyLeaves();
  row->calculate(none, none, ui::LayoutDirection::LTR);
  CHECK(frameIs(text, 0, 0, 70, 10));
  CHECK(frameIs(row, 0, 0, 70, 10));
}

// Children come and go at an index; a removed one lays out alone.
static void insertsAndRemovesChildren() {
  auto row = LayoutNode::create();
  row->set("flexDirection", s("row"));
  auto a = leaf(10, 10);
  auto b = leaf(20, 10);
  auto c = leaf(30, 10);

  row->insert(a, 0);
  row->insert(c, 1);
  row->insert(b, 1);
  row->calculate(none, none, ui::LayoutDirection::LTR);
  CHECK(frameIs(b, 10, 0, 20, 10));
  CHECK(frameIs(c, 30, 0, 30, 10));

  row->remove(b);
  CHECK(b->parent() == nullptr);
  row->calculate(none, none, ui::LayoutDirection::LTR);
  CHECK(frameIs(c, 10, 0, 30, 10));
  CHECK(frameIs(row, 0, 0, 40, 10));

  // Moved: removed, then inserted again elsewhere.
  row->remove(a);
  row->insert(a, 1);
  row->calculate(none, none, ui::LayoutDirection::LTR);
  CHECK(frameIs(c, 0, 0, 30, 10));
  CHECK(frameIs(a, 30, 0, 10, 10));
}

// A value back to undefined restores the default: the width is measured again.
static void restoresADefault() {
  auto column = LayoutNode::create();
  column->set("alignItems", s("flex-start"));
  auto text = leaf(40, 10);
  column->insert(text, 0);

  text->set("width", 100.0);
  column->calculate(none, none, ui::LayoutDirection::LTR);
  CHECK(frameIs(text, 0, 0, 100, 10));

  text->set("width", LayoutValue{});
  column->calculate(none, none, ui::LayoutDirection::LTR);
  CHECK(frameIs(text, 0, 0, 40, 10));
}

// Frames snap to the pixel grid of the scale given.
static void snapsToPixels() {
  auto row = LayoutNode::create();
  row->set("flexDirection", s("row"));
  row->setPointScale(3);
  auto a = leaf(10.1f, 10);
  auto b = leaf(5, 10);
  row->insert(a, 0);
  row->insert(b, 1);

  // 10.1 points are 30.3 pixels: 30, a third of a point at a time.
  row->calculate(none, none, ui::LayoutDirection::LTR);
  CHECK(frameIs(a, 0, 0, 10, 10));
  CHECK(frameIs(b, 10, 0, 5, 10));
}

// What React Native's style would refuse throws, naming it.
static void refusesWhatItDoesNotTake() {
  auto n = LayoutNode::create();
  auto refuses = [&](const char* key, LayoutValue v, const char* message) {
    try {
      n->set(key, v);
      CHECK(false);
    } catch (const std::invalid_argument& e) {
      CHECK(std::string(e.what()).find(message) != std::string::npos);
      if (std::string(e.what()).find(message) == std::string::npos) std::fprintf(stderr, "  %s\n", e.what());
    }
  };

  refuses("colour", 1.0, "no layout key colour");
  refuses("flexDirection", s("diagonal"), "flexDirection takes no diagonal");
  refuses("padding", s("auto"), "padding takes no auto");
  refuses("width", s("wide"), "width takes no wide");
  refuses("flexGrow", s("1"), "flexGrow takes a number");
}

// A parent gone first leaves its children whole, to lay out alone.
static void outlivesItsParent() {
  auto child = leaf(10, 10);
  {
    auto parent = LayoutNode::create();
    parent->insert(child, 0);
  }
  CHECK(child->parent() == nullptr);
  child->calculate(none, none, ui::LayoutDirection::LTR);
  CHECK(frameIs(child, 0, 0, 10, 10));
}

int main() {
  laysOutARow();
  sizesAColumnByItsContent();
  takesPercentsAndAuto();
  laysOutRightToLeft();
  nestsNodes();
  measuresAgainWhenDirty();
  insertsAndRemovesChildren();
  restoresADefault();
  snapsToPixels();
  refusesWhatItDoesNotTake();
  outlivesItsParent();

  std::printf("layout: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
