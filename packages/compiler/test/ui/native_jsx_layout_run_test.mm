// The Card fixture (native-jsx-layout-fixture.ts), mounted as a platform
// host mounts it (Mac Catalyst) and laid out at 400 by 200 points: each
// step commits props, lays the row out as UIKit would, and says whether
// the frames are where the style puts them. Frames are compared with each
// other and with the views' own measurements, never with font-dependent
// numbers.
#import <UIKit/UIKit.h>

#include <views/REGISTRATION.h>

#include <folly/json.h>
#include <hermes/hermes.h>
#include <lucent/native.h>
#include <lucent/platform/ios.h>
#include <lucent/view.h>
#include <react/renderer/core/RawPropsParser.h>
#include <react/utils/ContextContainer.h>

#include <cmath>
#include <cstdio>
#include <memory>
#include <string>
#include <vector>

namespace card = lucent::views::REGISTRATION;
namespace react = facebook::react;

namespace {

std::shared_ptr<const card::Props> commit(react::RawPropsParser& parser, const std::shared_ptr<const card::Props>& previous,
                                          const char* json) {
  react::ContextContainer container;
  react::PropsParserContext context{-1, container};
  react::RawProps raw(folly::parseJson(json));

  raw.parse(parser);

  return std::make_shared<const card::Props>(context, *previous, raw);
}

void say(const std::string& line) { std::printf("%s\n", line.c_str()); }

std::string text(NSString* s) { return s ? std::string(s.UTF8String) : "nil"; }

bool near(CGFloat a, CGFloat b) { return std::abs(a - b) < 0.01; }

std::string frame(UIView* v) {
  char out[96];
  std::snprintf(out, sizeof out, "(%g %g %g %g)", v.frame.origin.x, v.frame.origin.y, v.frame.size.width,
                v.frame.size.height);
  return out;
}

/// `ok` when every check holds, else what failed and the frames.
std::string verdict(const std::string& ok, const std::vector<std::pair<bool, std::string>>& checks) {
  std::string failed;
  for (auto& [holds, what] : checks)
    if (!holds) failed += (failed.empty() ? "" : "; ") + what;
  return failed.empty() ? ok : "wrong: " + failed;
}

/// A column's labels, top to bottom, and whether each is `gap` below the last.
std::string stacked(UIView* column, CGFloat gap) {
  NSArray<UIView*>* sorted = [column.subviews sortedArrayUsingComparator:^NSComparisonResult(UIView* a, UIView* b) {
    return a.frame.origin.y < b.frame.origin.y ? NSOrderedAscending : NSOrderedDescending;
  }];
  std::string names;
  bool apart = true;
  UIView* last = nil;
  for (UIView* v in sorted) {
    names += (names.empty() ? "" : " ") + text(((UILabel*)v).text);
    if (last ? !near(v.frame.origin.y, CGRectGetMaxY(last.frame) + gap) : !near(v.frame.origin.y, 0)) apart = false;
    if (!near(v.frame.size.width, column.bounds.size.width)) apart = false;
    last = v;
  }
  return names + (apart ? " stacked " + std::to_string(int(gap)) + " apart" : " misplaced");
}

/// Every frame under `v` on the pixel grid of `scale`.
bool onGrid(UIView* v, CGFloat scale, bool self = false) {
  auto grid = [scale](CGFloat x) { return std::abs(x * scale - std::round(x * scale)) < 0.01; };
  if (self && !(grid(v.frame.origin.x) && grid(v.frame.origin.y) && grid(v.frame.size.width) && grid(v.frame.size.height)))
    return false;
  // A stack view's own children are its own: not Yoga's grid.
  if ([v isKindOfClass:[UIStackView class]]) return true;
  for (UIView* c in v.subviews)
    if (!onGrid(c, scale, true)) return false;
  return true;
}

void run() {
  const long refs = lucent::liveNativeRefs();
  auto hermes = facebook::hermes::makeHermesRuntime();
  react::RawPropsParser parser;
  parser.prepare<card::Props>();

  auto content = lucent::ui::Content::create([] {});
  auto host = [&content](auto call) {
    lucent::ui::ContentEntry entry(content);

    call();
  };

  __weak UIView* made = nil;

  // UIKit's arrays (subviews, sorted copies) are autoreleased: the pool lets them go before the release check.
  @autoreleasepool {
  // As the host does, for a debug build's snapshot.
  lucent::objc::installViewTree();

  auto empty = std::make_shared<const card::Props>();
  auto props = commit(parser, empty,
                      R"({"p0": "Hello", "p1": false, "p2": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}]})");
  std::shared_ptr<card::Mount> mount;
  host([&] { mount = card::Mount::create(*props, [](const card::Event&) {}); });

  UIView* row = (UIView*)lucent::objc::unwrap(mount->view());
  made = row;
  row.frame = CGRectMake(0, 0, 400, 200);
  [row layoutIfNeeded];

  UILabel* title = (UILabel*)row.subviews[0];
  UIView* spacer = row.subviews[1];
  UIView* column = row.subviews[2];
  UIStackView* stack = (UIStackView*)row.subviews[3];

  auto step = [&](const char* json) {
    auto next = commit(parser, props, json);
    host([&] { mount->update(*next, *props); });
    props = next;
    [row layoutIfNeeded];
  };

  const CGSize titleFits = [title sizeThatFits:CGSizeMake(CGFLOAT_MAX, CGFLOAT_MAX)];
  say("mounted: " + verdict("title at the padding, children 8 apart, spacer fills the row",
                            {{near(title.frame.origin.x, 10) && near(title.frame.origin.y, 10), "title " + frame(title)},
                             {title.frame.size.width >= titleFits.width - 0.01, "title narrower than its text"},
                             {near(spacer.frame.origin.x, CGRectGetMaxX(title.frame) + 8), "spacer " + frame(spacer)},
                             {near(column.frame.origin.x, CGRectGetMaxX(spacer.frame) + 8), "column " + frame(column)},
                             {near(stack.frame.origin.x, CGRectGetMaxX(column.frame) + 8 + 4), "stack " + frame(stack)},
                             {near(CGRectGetMaxX(stack.frame) + 4, 400 - 10), "row not filled"}}));

  // A debug build's snapshot: the mount, at its setup's source, and its views' tree.
  const std::string snapshot = lucent::ui::debugSnapshot();
  const auto has = [&](const char* s) { return snapshot.find(s) != std::string::npos; };
  say(std::string("snapshot: ") +
      (has("\"source\":\"card.ios.lucent.tsx:") && has("\"class\":\"LucentFlexView\"") &&
               has("\"class\":\"UILabel\"") && has("\"class\":\"UIStackView\"") &&
               has("\"frame\":[0,0,400,200]") && has("\"effects\":")
           ? "the mount, its Flex, labels and stack, framed"
           : snapshot));

  say("column: " + stacked(column, 4) + (near(column.frame.size.width, 60) ? ", 60 wide" : ", " + frame(column)));

  // The stack lays its own children out; laying it out again moves nothing.
  NSMutableArray<NSValue*>* placed = [NSMutableArray array];
  for (UIView* v in stack.arrangedSubviews) [placed addObject:[NSValue valueWithCGRect:v.frame]];
  [stack setNeedsLayout];
  [stack layoutIfNeeded];
  bool kept = stack.arrangedSubviews.count == 2;
  for (NSUInteger i = 0; kept && i < placed.count; i++) kept = CGRectEqualToRect(placed[i].CGRectValue, stack.arrangedSubviews[i].frame);
  const bool second = near(stack.arrangedSubviews[1].frame.origin.y, CGRectGetMaxY(stack.arrangedSubviews[0].frame) + 2);
  say("stack: " + verdict("4 in from its place, its labels where it put them",
                          {{near(stack.frame.origin.y, 10 + 4), "stack " + frame(stack)},
                           {kept, "its labels moved"},
                           {second, "its labels not 2 apart: " + frame(stack.arrangedSubviews[0]) + " " +
                                        frame(stack.arrangedSubviews[1]) + " in " + frame(stack)}}));

  const CGFloat titleWas = title.frame.size.width;
  const CGFloat spacerWas = spacer.frame.size.width;
  const CGFloat columnWas = column.frame.origin.x;
  step(R"({"p0": "Hello there, a wider title"})");
  say("retitled: " + verdict("title wider, spacer narrower, column in place",
                             {{title.frame.size.width > titleWas, "title " + frame(title)},
                              {spacer.frame.size.width < spacerWas, "spacer " + frame(spacer)},
                              {near(column.frame.origin.x, columnWas), "column " + frame(column)}}));

  step(R"({"p1": true})");
  say(std::string("widened: ") + (near(column.frame.size.width, 120) ? "column 120 wide" : "column " + frame(column)));

  step(R"({"p2": [{"id": "a", "name": "A"}, {"id": "b", "name": "B"}, {"id": "c", "name": "C"}]})");
  say("grown: " + stacked(column, 4));

  step(R"({"p2": [{"id": "c", "name": "C"}, {"id": "a", "name": "A"}, {"id": "b", "name": "B"}]})");
  say("reordered: " + stacked(column, 4));

  row.semanticContentAttribute = UISemanticContentAttributeForceRightToLeft;
  [row setNeedsLayout];
  [row layoutIfNeeded];
  say(std::string("right to left: ") +
      (near(CGRectGetMaxX(title.frame), 400 - 10) ? "title at the right padding" : "title " + frame(title)));

  CGFloat scale = row.traitCollection.displayScale;
  if (scale <= 0) scale = UIScreen.mainScreen.scale;
  say(std::string("pixels: ") + (onGrid(row, scale) ? "every frame on the grid" : "off the grid"));

  const CGSize fits = [row sizeThatFits:CGSizeMake(CGFLOAT_MAX, CGFLOAT_MAX)];
  const CGSize titleNow = [title sizeThatFits:CGSizeMake(CGFLOAT_MAX, CGFLOAT_MAX)];
  const CGFloat width = 10 + titleNow.width + 8 + 0 + 8 + 120 + 8 + 4 + stack.frame.size.width + 4 + 10;
  const CGFloat tallest = std::max({(CGFloat)title.frame.size.height, (CGFloat)1, column.frame.size.height,
                                    stack.frame.size.height + 8});
  const bool fitsWidth = std::abs(fits.width - width) <= 2.0 / scale;
  const bool fitsHeight = std::abs(fits.height - (10 + tallest + 10)) <= 1.0 / scale;
  say(std::string("sized by content: ") +
      (fitsWidth && fitsHeight ? "fits its children and padding"
                               : "got " + std::to_string(fits.width) + " x " + std::to_string(fits.height) + ", expected " +
                                     std::to_string(width) + " x " + std::to_string(10 + tallest + 10)));

  title = nil;
  spacer = nil;
  column = nil;
  stack = nil;
  content.reset();
  mount->dispose();
  mount.reset();
  row = nil;
  }

  say(std::string("forgotten: ") +
      (lucent::ui::debugSnapshot().find("\"mounts\":[]") != std::string::npos ? "no mounts" : "a mount kept"));
  say(std::string("released: native references ") + (lucent::liveNativeRefs() == refs ? "all released" : "held") +
      ", row " + (made ? "kept" : "gone"));
}

}  // namespace

int main() { run(); }
