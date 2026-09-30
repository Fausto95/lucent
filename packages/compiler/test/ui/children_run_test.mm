// React children in the iOS host (Mac Catalyst, UIKit, React Native's
// prebuilt view classes), driven as React Native's mounting manager drives
// a component view: children mounted before their parent's first commit,
// then reordered, inserted and removed; the layout the renderer gives; the
// view recycled and mounted again; a slot its setup leaves out; children
// given to a component taking none. Prints one line per step;
// children-run.test.ts compares them, and the host's reports of where the
// slot is (LUCENT_SIZING lines, when traced).
#import <React/RCTViewComponentView.h>
#import <UIKit/UIKit.h>

#include <views/CARD.h>
#include <views/LABEL.h>
#include <views/POCKET.h>

#include <folly/json.h>
#include <react/renderer/core/LayoutMetrics.h>
#include <react/renderer/core/RawPropsParser.h>
#include <react/utils/ContextContainer.h>

#include <cstdio>
#include <memory>
#include <string>
#include <vector>

#import "LucentComponentView.h"

namespace react = facebook::react;

namespace {

/** A commit's props for component `Name`, as the renderer parses them. */
template <typename Props>
std::shared_ptr<const Props> commit(const char* json) {
  static react::RawPropsParser parser = [] {
    react::RawPropsParser p;
    p.prepare<Props>();
    return p;
  }();
  react::ContextContainer container;
  react::PropsParserContext context{-1, container};
  react::RawProps raw(folly::parseJson(json));

  raw.parse(parser);

  return std::make_shared<const Props>(context, Props(), raw);
}

void say(const std::string& line) { std::printf("%s\n", line.c_str()); }

/** A view React Native mounts as a child: a plain component view with a tag, at `frame` (the parent's coordinates). */
RCTViewComponentView* child(NSInteger tag, CGRect frame) {
  RCTViewComponentView* view = [[RCTViewComponentView alloc] initWithFrame:frame];

  view.tag = tag;

  return view;
}

/** The tags of a view's subviews, in order. */
std::string tags(UIView* view) {
  std::string out;

  for (UIView* v in view.subviews) out += (out.empty() ? "" : " ") + std::to_string(v.tag);

  return out.empty() ? "nothing" : out;
}

/** Where a child is: its parent's tag, or none. */
std::string where(UIView* view) { return view.superview ? "in a view" : "in none"; }

/**
 * The first state of a view of the component `Descriptor` describes, as
 * the renderer makes it: updates posted to it go nowhere (no renderer).
 */
template <typename Descriptor>
react::State::Shared initialState(const react::Props::Shared& props, react::Tag tag) {
  static Descriptor descriptor(
      react::ComponentDescriptorParameters{.eventDispatcher = {}, .contextContainer = nullptr, .flavor = nullptr});
  // Kept: a state holds its family weakly.
  static std::vector<react::ShadowNodeFamily::Shared> families;

  families.push_back(descriptor.createFamily({.tag = tag, .surfaceId = 1, .instanceHandle = nullptr}));

  return descriptor.createInitialState(props, families.back());
}

/** What a commit gives a component view, in the order the mounting manager gives it. */
void mountCommit(LucentComponentView* view, const react::Props::Shared& props, CGSize size, CGFloat padding) {
  react::LayoutMetrics metrics;

  metrics.frame = {{0, 0}, {static_cast<float>(size.width), static_cast<float>(size.height)}};
  metrics.contentInsets = {static_cast<float>(padding), static_cast<float>(padding), static_cast<float>(padding),
                           static_cast<float>(padding)};

  [view updateProps:props oldProps:nullptr];
  [view updateLayoutMetrics:metrics oldLayoutMetrics:react::EmptyLayoutMetrics];
  [view finalizeUpdates:RNComponentViewUpdateMaskAll];
  [view layoutIfNeeded];
}

void run() {
  auto* card = (LucentComponentView*)[[NSClassFromString(@"CARDComponentView") alloc] initWithFrame:CGRectZero];
  auto* a = child(11, CGRectMake(10, 10, 50, 20));
  auto* b = child(12, CGRectMake(10, 30, 50, 20));

  // Children first: React Native inserts a new view's children before it commits the view.
  [card mountChildComponentView:a index:0];
  [card mountChildComponentView:b index:1];
  say("before mount: 11 " + where(a) + ", 12 " + where(b));

  auto trip = commit<lucent::views::CARD::Props>(R"({"p0": "Trip"})");

  [card updateState:initialState<lucent::views::CARD::ComponentDescriptor>(trip, 10) oldState:nullptr];
  mountCommit(card, trip, CGSizeMake(200, 100), 10);

  UIView* slot = card.lucentSlot;
  UIView* content = card.contentView;

  say("mounted: slot holds " + tags(slot) + ", in the card: " + ([slot isDescendantOfView:content] ? "yes" : "no") +
      ", clips: " + (slot.clipsToBounds ? "yes" : "no"));

  // Yoga's frames are the host's coordinates, wherever the slot is (here: in the padded content).
  CGPoint at = [a convertPoint:CGPointZero toView:card];
  say("laid out: 11 at " + std::to_string(int(at.x)) + "," + std::to_string(int(at.y)) + " of the host");

  // A native view holding the slot moves without laying the slot out (as
  // an effect of the next commit could move it): the slot follows it, and
  // its host reports it 5 pt in from the content box's top left.
  content.frame = CGRectOffset(content.frame, 5, 5);
  [card updateProps:commit<lucent::views::CARD::Props>(R"({"p0": "Moved"})") oldProps:nullptr];
  [card finalizeUpdates:RNComponentViewUpdateMaskProps];
  [card layoutIfNeeded];
  at = [a convertPoint:CGPointZero toView:card];
  say("moved natively: 11 at " + std::to_string(int(at.x)) + "," + std::to_string(int(at.y)) + " of the host");

  // A move is a remove and an insert.
  [card unmountChildComponentView:b index:1];
  [card mountChildComponentView:b index:0];
  say("reordered: " + tags(slot));

  auto* c = child(13, CGRectMake(10, 50, 50, 20));

  [card mountChildComponentView:c index:1];
  [card unmountChildComponentView:a index:2];
  say("inserted, removed: " + tags(slot) + ", 11 " + where(a));

  // Unmounted: React Native removes the children first, then recycles the view.
  [card unmountChildComponentView:b index:0];
  [card unmountChildComponentView:c index:0];
  [card prepareForRecycle];
  say(std::string("recycled: slot ") + (card.lucentSlot ? "kept" : "none") + ", old slot holds " + tags(slot));

  auto* d = child(14, CGRectMake(0, 0, 50, 20));

  [card mountChildComponentView:d index:0];
  mountCommit(card, commit<lucent::views::CARD::Props>(R"({"p0": "Again"})"), CGSizeMake(200, 100), 0);
  say(std::string("remounted: ") + (card.lucentSlot == slot ? "same" : "new") + " slot holds " + tags(card.lucentSlot));

  // A slot its setup never put in its view: reported, the children kept in it.
  auto* pocket = (LucentComponentView*)[[NSClassFromString(@"POCKETComponentView") alloc] initWithFrame:CGRectZero];
  auto* e = child(15, CGRectMake(0, 0, 10, 10));

  [pocket mountChildComponentView:e index:0];
  mountCommit(pocket, commit<lucent::views::POCKET::Props>("{}"), CGSizeMake(100, 100), 0);
  say("pocket: slot holds " + tags(pocket.lucentSlot) + ", in its view: " +
      ([pocket.lucentSlot isDescendantOfView:pocket.contentView] ? "yes" : "no"));

  // Children given to a component taking none: reported, placed nowhere.
  auto* label = (LucentComponentView*)[[NSClassFromString(@"LABELComponentView") alloc] initWithFrame:CGRectZero];
  auto* f = child(16, CGRectMake(0, 0, 10, 10));

  [label mountChildComponentView:f index:0];
  mountCommit(label, commit<lucent::views::LABEL::Props>(R"({"p0": "Hi"})"), CGSizeMake(100, 20), 0);
  say("label: 16 " + where(f) + ", content holds " + std::to_string(label.contentView.subviews.count) + " views");

  [label unmountChildComponentView:f index:0];
  say("label: 16 unmounted " + where(f));
}

}  // namespace

int main() {
  @autoreleasepool {
    // As React Native calls a component view: on the main thread, outside any turn of Lucent's main context.
    run();
  }
}
