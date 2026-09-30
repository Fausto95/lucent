// Unit tests for how a component's host sizes to its content
// (lucent/sizing.h): the pixel grid measurements snap to, which
// measurements answer which constraints, what the layout asks for, which
// results the shadow tree accepts (for the constraints it asked for, from
// the newest content revision), and when the host measures and posts a
// result. Built and run by `packages/runtime/test/run.sh`, also under
// ASan/UBSan and TSan.
#include <cmath>
#include <cstdio>
#include <optional>
#include <string_view>

#include "lucent/sizing.h"

using namespace lucent::sizing;

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

static const Constraints wide{300, kUnbounded};
static const Constraints narrow{150, kUnbounded};

static SizeState requested(Constraints constraints) { return SizeState{constraints, std::nullopt}; }

static SizeState measured(Constraints constraints, Measurement measurement) {
  return SizeState{constraints, measurement};
}

// Sizes go up to the next physical pixel (text must not be cut), with no
// pixel added for a float's rounding error; an unbounded axis stays so.
static void snapsUpToThePixelGrid() {
  CHECK(snap(10.1f, 3) == std::ceil(10.1f * 3) / 3);
  CHECK(snap(10.0f + 1e-5f, 2) == 10.0f);
  CHECK(snap(0, 3) == 0);
  // No negative zero: a size is never below zero (traces print -0x-0).
  CHECK(!std::signbit(snap(0, 3)));
  CHECK(!std::signbit(snap(-0.0f, 2)));
  CHECK(std::isinf(snap(kUnbounded, 3)));

  CHECK(same(20.2f, 20.3f, 3));
  CHECK(!same(20.0f, 20.5f, 3));
  CHECK(same(kUnbounded, kUnbounded, 3));
  CHECK(!same(kUnbounded, 300, 3));
  CHECK(same(Constraints{300, kUnbounded}, Constraints{300.1f, kUnbounded}, 2));
  CHECK(!same(Constraints{300, kUnbounded}, Constraints{300, 40}, 2));
}

// What a measurement answers: the constraints it was made under, and
// stricter bounds it fits within (Yoga's own measure cache assumes as
// much), never a looser bound it may have been cut by, nor another font
// scale or direction.
static void answersBoundsItFits() {
  const float scale = 2;
  Measurement column{1, {300, 842}, {120, 20}};

  CHECK(answers(column, {300, 842}, scale));
  CHECK(answers(column, {300, 746}, scale));
  CHECK(answers(column, {300, 20}, scale));
  CHECK(!answers(column, {300, 19}, scale));
  CHECK(!answers(column, {300, 900}, scale));
  CHECK(!answers(column, {300, kUnbounded}, scale));

  // Wrapped at 300: cut by that bound, so a looser one may differ.
  Measurement wrapped{1, wide, {298.5f, 60}};

  CHECK(answers(wrapped, {299, kUnbounded}, scale));
  CHECK(!answers(wrapped, {400, kUnbounded}, scale));
  CHECK(!answers(wrapped, narrow, scale));

  // No bound: its natural size, which answers any bound it fits.
  Measurement natural{1, {kUnbounded, kUnbounded}, {80, 20}};

  CHECK(answers(natural, {80, 20}, scale));
  CHECK(!answers(natural, {79, 20}, scale));

  // Text sizes with the font scale; the direction is part of the layout.
  CHECK(!answers(column, {300, 842, 1.3f}, scale));
  CHECK(!answers(column, {300, 842, 1, Direction::RightToLeft}, scale));
  CHECK(answers(Measurement{1, {300, 842, 1.3f, Direction::RightToLeft}, {120, 20}},
                {300, 700, 1.3f, Direction::RightToLeft}, scale));
  CHECK(!same(Constraints{300, 842}, Constraints{300, 842, 1.3f}, scale));
  CHECK(!same(Constraints{300, 842}, Constraints{300, 842, 1, Direction::RightToLeft}, scale));
}

// The layout asks for constraints only when the measurement it holds does
// not answer them: a column's height bound shrinking as siblings are added
// asks for nothing; a pending request the layout no longer needs is
// replaced.
static void asksOnlyForWhatItLacks() {
  const float scale = 2;

  CHECK(request(SizeState{}, wide, scale) == std::optional<Constraints>(wide));
  CHECK(!request(requested(wide), wide, scale));
  CHECK(request(requested(wide), narrow, scale) == std::optional<Constraints>(narrow));

  auto column = measured({300, 842}, Measurement{1, {300, 842}, {120, 20}});

  CHECK(!request(column, {300, 746}, scale));
  CHECK(request(column, {300, 900}, scale) == std::optional<Constraints>(Constraints{300, 900}));
  CHECK(request(column, {300, 842, 1.3f}, scale) == std::optional<Constraints>(Constraints{300, 842, 1.3f}));

  // Narrowed (the measurement does not fit 150), then back to 300 before
  // the host answered: the pending 150 is no longer what the layout needs.
  auto wrapped = measured(narrow, Measurement{1, wide, {298.5f, 60}});

  CHECK(request(wrapped, wide, scale) == std::optional<Constraints>(wide));
  CHECK(!request(measured(wide, Measurement{1, wide, {298.5f, 60}}), wide, scale));
}

// The shadow tree takes a result for the constraints it asks for now, from
// a content revision no older than the one it has.
static void acceptsOnlyCurrentResults() {
  const float scale = 3;

  CHECK(judge(SizeState{}, Measurement{1, wide, {120, 20}}, scale) == Verdict::StaleConstraints);
  CHECK(judge(requested(wide), Measurement{1, wide, {120, 20}}, scale) == Verdict::Accepted);
  CHECK(judge(requested(narrow), Measurement{1, wide, {200, 20}}, scale) == Verdict::StaleConstraints);
  // Measured under a looser bound it did not reach: as good as one under narrow.
  CHECK(judge(requested(narrow), Measurement{1, wide, {120, 20}}, scale) == Verdict::Accepted);

  auto state = measured(wide, Measurement{5, wide, {120, 20}});

  CHECK(judge(state, Measurement{4, wide, {120, 40}}, scale) == Verdict::StaleRevision);
  CHECK(judge(state, Measurement{6, wide, {120, 40}}, scale) == Verdict::Accepted);
  CHECK(judge(state, Measurement{5, wide, {120.2f, 20.1f}}, scale) == Verdict::Unchanged);
  CHECK(judge(state, Measurement{6, wide, {120, 20}}, scale) == Verdict::Unchanged);
  CHECK(judge(state, Measurement{6, wide, {120, 20.5f}}, scale) == Verdict::Accepted);

  // Constraints changed since that measurement: a result for them is new.
  auto moved = measured(narrow, Measurement{5, wide, {200, 20}});

  CHECK(judge(moved, Measurement{5, narrow, {150, 40}}, scale) == Verdict::Accepted);

  // A result that answers what the layout asks now, though measured under
  // a looser bound, is current; one for another font scale is not.
  auto column = measured({300, 746}, Measurement{1, {300, 842}, {120, 20}});

  CHECK(judge(column, Measurement{2, {300, 842}, {120, 40}}, scale) == Verdict::Accepted);
  CHECK(judge(column, Measurement{2, {300, 842}, {120, 800}}, scale) == Verdict::StaleConstraints);
  CHECK(judge(column, Measurement{2, {300, 746, 1.3f}, {120, 40}}, scale) == Verdict::StaleConstraints);
  CHECK(verdictName(Verdict::StaleRevision) == std::string_view("stale revision"));
}

// The host measures when the shadow tree asks for constraints it has not
// measured, or when its content changed since; it posts what the state
// does not hold already.
static void measuresWhatChanged() {
  const float scale = 2;
  Measurer measurer(scale);

  CHECK(!measurer.due(SizeState{}));
  CHECK(measurer.due(requested(wide)) == std::optional<Constraints>(wide));

  auto posted = measurer.record(requested(wide), wide, {100.2f, 19.9f});

  CHECK(posted.has_value());
  CHECK(posted->revision == measurer.revision());
  CHECK(posted->size.width == 100.5f);
  CHECK(posted->size.height == 20.0f);
  CHECK(!measurer.due(requested(wide)));

  auto state = measured(wide, *posted);

  measurer.observe(state);
  CHECK(!measurer.due(state));

  // The content changed: measured again, posted only if the size did.
  measurer.contentChanged();
  CHECK(measurer.due(state) == std::optional<Constraints>(wide));
  CHECK(!measurer.record(state, wide, {100.5f, 20}).has_value());
  CHECK(!measurer.due(state));

  measurer.contentChanged();
  auto grown = measurer.record(state, wide, {200.5f, 60});

  CHECK(grown.has_value() && grown->size.height == 60);

  // New constraints: measured under them.
  auto narrowed = measured(narrow, *grown);

  CHECK(measurer.due(narrowed) == std::optional<Constraints>(narrow));

  // A stricter bound its last measurement fits: nothing to measure.
  CHECK(!measurer.due(requested({200.5f, 60})));
  CHECK(measurer.due(requested({200.5f, 59})).has_value());
}

// A result the renderer has not judged yet says what a new one the same
// size under the same constraints would: that one is not posted (Android
// measures again when the content asks for a layout after a commit).
static void postsNoRepeatOfAPendingResult() {
  const float scale = 2;
  Measurer measurer(scale);
  auto state = requested(wide);
  auto first = measurer.record(state, wide, {100, 20});

  CHECK(first.has_value());

  measurer.contentChanged();
  CHECK(!measurer.record(state, wide, {99.8f, 20}, first).has_value());
  CHECK(!measurer.due(state));

  // Judged since (pending no more), or another size: posted.
  measurer.contentChanged();
  CHECK(measurer.record(state, wide, {100, 20}).has_value());

  measurer.contentChanged();
  CHECK(measurer.record(state, wide, {100, 40}, first).has_value());

  // The bound counts posts only.
  Measurer bounded(scale);
  auto pending = bounded.record(state, wide, {10, 10});

  for (int i = 0; i < 10; ++i) {
    bounded.contentChanged();
    bounded.record(state, wide, {10, 10}, pending);
  }

  CHECK(!bounded.gaveUp());
}

// A result whose layout asks for other constraints, whose result asks for
// the first ones again… stops: a bounded number of posts until the state
// settles (it holds a result for the constraints it asks for) or the
// content changes.
static void boundsAFeedbackLoop() {
  const float scale = 2;
  Measurer measurer(scale);
  SizeState state = requested(wide);
  int posts = 0;

  for (int pass = 0; pass < 20; ++pass) {
    measurer.observe(state);

    auto constraints = measurer.due(state);

    if (!constraints) break;

    auto posted = measurer.record(state, *constraints, {constraints->maxWidth, 1000 / constraints->maxWidth});

    if (!posted) break;

    ++posts;
    // Its layout asks for the other width.
    state = measured(same(*constraints, wide, scale) ? narrow : wide, *posted);
  }

  CHECK(posts == Measurer::kMaxUnsettledPosts);
  CHECK(measurer.gaveUp());

  // Settled, then changed: measured and posted again.
  measurer.contentChanged();
  CHECK(!measurer.gaveUp());
  CHECK(measurer.due(state).has_value());

  Measurer settled(scale);

  for (int pass = 0; pass < 10; ++pass) {
    auto s = requested(pass % 2 ? narrow : wide);
    auto posted = settled.record(s, *s.requested, {10, 10 + static_cast<float>(pass)});

    CHECK(posted.has_value());
    // Each result settles its state: the next constraints come from outside.
    settled.observe(measured(*s.requested, *posted));
  }

  CHECK(!settled.gaveUp());
}

int main() {
  snapsUpToThePixelGrid();
  answersBoundsItFits();
  asksOnlyForWhatItLacks();
  acceptsOnlyCurrentResults();
  measuresWhatChanged();
  postsNoRepeatOfAPendingResult();
  boundsAFeedbackLoop();

  std::printf("sizing: %d checks, %d failures\n", checks, failures);
  return failures == 0 ? 0 : 1;
}
