// Unit tests for where a component lays out its React children
// (lucent/slots.h): the slot's insets in the content box, the pixel grid
// they snap to, which reports the shadow tree accepts, the border widths
// layout resolves a style's edges to, and when the host posts a report.
// Built and run by `packages/runtime/test/run.sh`, also under ASan/UBSan
// and TSan.
#include <cstdio>
#include <optional>

#include "lucent/slots.h"

using namespace lucent::slots;

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

static bool equal(const Insets& a, float left, float top, float right, float bottom) {
  return a.left == left && a.top == top && a.right == right && a.bottom == bottom;
}

// A slot below a 40 pt header, as wide as the content box: inset from the
// top only. A slot reaching past the content box is inset by nothing there.
static void measuresTheSlotInTheContentBox() {
  const Rect content{12, 12, 176, 126};

  CHECK(equal(insetsOf({12, 52, 176, 86}, content), 0, 40, 0, 0));
  CHECK(equal(insetsOf(content, content), 0, 0, 0, 0));
  CHECK(equal(insetsOf({20, 30, 100, 50}, content), 8, 18, 68, 58));
  CHECK(equal(insetsOf({0, 0, 400, 400}, content), 0, 0, 0, 0));
}

// Insets go to the nearest physical pixel; within a pixel they are the same.
static void snapsToThePixelGrid() {
  CHECK(equal(snap(Insets{40.1f, 0.2f, 13.5f, 0}, 2), 40, 0, 13.5f, 0));
  CHECK(equal(snap(Insets{40.3f, 0, 0, 0}, 3), 40.333332f, 0, 0, 0));

  CHECK(same(Insets{40, 0, 0, 0}, Insets{40.3f, 0, 0, 0}, 3));
  CHECK(!same(Insets{40, 0, 0, 0}, Insets{40.5f, 0, 0, 0}, 3));
  CHECK(none(Insets{0.2f, 0, 0, 0.1f}, 3));
  CHECK(!none(Insets{0, 1, 0, 0}, 3));
}

// The shadow tree takes the newest report that changes where its children go.
static void acceptsReportsThatMoveTheChildren() {
  const float scale = 3;
  const Placement header{1, {0, 40, 0, 0}};

  CHECK(judge(std::nullopt, header, scale) == Verdict::Accepted);
  CHECK(judge(header, Placement{2, {0, 40.1f, 0, 0}}, scale) == Verdict::Unchanged);
  CHECK(judge(header, Placement{2, {0, 64, 0, 0}}, scale) == Verdict::Accepted);
  CHECK(judge(Placement{3, {0, 64, 0, 0}}, Placement{2, {0, 40, 0, 0}}, scale) == Verdict::StaleRevision);

  // A slot filling the content box before any report changes nothing.
  CHECK(judge(std::nullopt, Placement{1, {}}, scale) == Verdict::Unchanged);
  CHECK(judge(Placement{1, {}}, Placement{2, {}, true, true}, scale) == Verdict::Unchanged);

  // The direction decides which style edge each inset goes to.
  CHECK(judge(Placement{1, {8, 0, 0, 0}}, Placement{2, {8, 0, 0, 0}, true}, scale) == Verdict::Accepted);
  CHECK(judge(Placement{1, {8, 0, 0, 0}, true}, Placement{2, {8, 0, 0, 0}, true, true}, scale) == Verdict::Accepted);
}

// Border widths as layout resolves a style's edges (Yoga's precedence),
// in each direction, with React Native's left-and-right swap.
static void resolvesBorderEdges() {
  CHECK(equal(resolve(BorderEdges{}, false, false), 0, 0, 0, 0));
  CHECK(equal(resolve(BorderEdges{.all = 2}, false, false), 2, 2, 2, 2));
  CHECK(equal(resolve(BorderEdges{.all = 2, .horizontal = 3, .top = 5}, false, false), 3, 5, 3, 2));
  CHECK(equal(resolve(BorderEdges{.vertical = 4, .left = 1}, false, false), 1, 4, 0, 4));
  CHECK(equal(resolve(BorderEdges{.all = -3}, false, false), 0, 0, 0, 0));

  const BorderEdges logical{.left = 1, .right = 2, .start = 5};

  CHECK(equal(resolve(logical, false, false), 5, 0, 2, 0));
  CHECK(equal(resolve(logical, true, false), 1, 0, 5, 0));

  // Swapped (right to left): left and right mean start and end.
  CHECK(equal(resolve(BorderEdges{.left = 1, .right = 2}, true, true), 2, 0, 1, 0));
  CHECK(equal(resolve(BorderEdges{.left = 1, .start = 5}, true, true), 0, 0, 1, 0));
}

// The host posts what the shadow tree lacks, once while it is pending, and
// at most kMaxUnsettledPosts until the shadow tree holds what it measures.
static void postsWhatTheShadowTreeLacks() {
  const float scale = 2;
  Reporter reporter(scale);

  // The default slot fills the content box: nothing to post.
  CHECK(!reporter.record(std::nullopt, {}, false, false));

  auto first = reporter.record(std::nullopt, {0, 40.2f, 0, 0}, false, false);

  CHECK(first.has_value());
  CHECK(first && first->revision == 1 && equal(first->insets, 0, 40, 0, 0));
  // Pending: measured again before the shadow tree has it.
  CHECK(!reporter.record(std::nullopt, {0, 40, 0, 0}, false, false));
  // Held: settled.
  CHECK(!reporter.record(first, {0, 40, 0, 0}, false, false));

  auto moved = reporter.record(first, {0, 64, 0, 0}, false, false);

  CHECK(moved && moved->revision == 2);
  // Direction changes where insets go.
  auto turned = reporter.record(moved, {0, 64, 0, 0}, true, true);

  CHECK(turned.has_value());
  // Back to filling the content box.
  CHECK(turned && reporter.record(turned, {}, true, true).has_value());
}

// A slot whose place follows the size its report gives (a fixed slot in a
// component sized by its children) cannot make layout loop.
static void boundsAFeedbackLoop() {
  const float scale = 2;
  Reporter reporter(scale);
  std::optional<Placement> held;
  int posts = 0;

  for (int pass = 0; pass < 10; ++pass) {
    auto posted = reporter.record(held, {0, 40, 0, 10 + 50.0f * pass}, false, false);

    if (!posted) break;

    ++posts;
    held = posted;
  }

  CHECK(posts == Reporter::kMaxUnsettledPosts);
  CHECK(reporter.gaveUp());

  // The mount's native views changed: posted again.
  reporter.contentChanged();
  CHECK(!reporter.gaveUp());
  CHECK(reporter.record(held, {0, 40, 0, 500}, false, false).has_value());

  // Each report settles before the next move: never bounded.
  Reporter settled(scale);
  std::optional<Placement> state;

  for (int pass = 0; pass < 10; ++pass) {
    auto posted = settled.record(state, {0, 10.0f + static_cast<float>(pass), 0, 0}, false, false);

    CHECK(posted.has_value());
    state = posted;
    CHECK(!settled.record(state, state->insets, false, false));
  }

  CHECK(!settled.gaveUp());
}

int main() {
  measuresTheSlotInTheContentBox();
  snapsToThePixelGrid();
  acceptsReportsThatMoveTheChildren();
  resolvesBorderEdges();
  postsWhatTheShadowTreeLacks();
  boundsAFeedbackLoop();

  std::printf("slots: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
