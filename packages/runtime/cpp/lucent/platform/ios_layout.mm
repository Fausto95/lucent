// Lucent runtime — a Flex on iOS (T50, ui_flex.h): LucentFlexView, a
// UIView laying its subviews out with the layout core. It writes its
// children's frames in layoutSubviews (the outermost Flex of a tree lays
// the tree out at its bounds first), answers sizeThatFits: from the tree,
// and asks UIKit for a layout when the tree changes or its mount's code
// has run.
//
// A leaf is measured by what it says of itself: a class overriding
// sizeThatFits: (UILabel, UISwitch) by that; a view whose own constraints
// lay its content out (a stack view's, for its arranged views) by Auto
// Layout (systemLayoutSizeFittingSize:, its frame's constraints off while
// it measures); any other by its intrinsic size (a plain view: none,
// zero). None feeds the frame a Flex gave it back into its measurement,
// as UIView's own sizeThatFits: (the size it has) would, and as Auto
// Layout does for a view no constraint sizes.
#import <UIKit/UIKit.h>

#include <algorithm>
#include <cmath>
#include <vector>

#include "../ui_flex.h"
#include "ios.h"

using lucent::NativeRef;
using lucent::ui::FlexChild;
using lucent::ui::LayoutDirection;
using lucent::ui::LayoutNode;
using lucent::ui::MeasureMode;

@interface LucentFlexView : UIView
- (instancetype)initWithNode:(std::shared_ptr<LayoutNode>)node content:(std::weak_ptr<lucent::ui::Content>)content;
- (void)lucentInsert:(const FlexChild&)child at:(int)index;
- (void)lucentRemove:(const FlexChild&)child;
@end

namespace {

CGFloat scaleOf(UIView* v) {
  if (v.window.screen.scale > 0) return v.window.screen.scale;
  if (v.traitCollection.displayScale > 0) return v.traitCollection.displayScale;
  return UIScreen.mainScreen.scale;
}

LayoutDirection directionOf(UIView* v) {
  return v.effectiveUserInterfaceLayoutDirection == UIUserInterfaceLayoutDirectionRightToLeft ? LayoutDirection::RTL
                                                                                               : LayoutDirection::LTR;
}

/// A bound UIKit gives (CGFLOAT_MAX, or zero: as large as it likes) as Yoga's none.
float boundOf(CGFloat v) { return v <= 0 || v >= CGFLOAT_MAX / 2 ? NAN : static_cast<float>(v); }

bool overridesSizeThatFits(Class cls) {
  return [cls instanceMethodForSelector:@selector(sizeThatFits:)] != [UIView instanceMethodForSelector:@selector(sizeThatFits:)];
}

/// `view`'s size under what Yoga offers, by what its class says of itself.
CGSize measured(UIView* view, float width, MeasureMode wm, float height, MeasureMode hm) {
  if (overridesSizeThatFits(view.class))
    return [view sizeThatFits:CGSizeMake(wm == MeasureMode::Undefined ? CGFLOAT_MAX : width,
                                         hm == MeasureMode::Undefined ? CGFLOAT_MAX : height)];

  [view updateConstraintsIfNeeded];

  if (view.constraints.count == 0) {
    const CGSize own = view.intrinsicContentSize;
    return {own.width == UIViewNoIntrinsicMetric ? 0 : own.width, own.height == UIViewNoIntrinsicMetric ? 0 : own.height};
  }

  const BOOL translated = view.translatesAutoresizingMaskIntoConstraints;
  const CGSize target = {wm == MeasureMode::Exactly ? width : 0, hm == MeasureMode::Exactly ? height : 0};

  view.translatesAutoresizingMaskIntoConstraints = NO;
  const CGSize fits = [view systemLayoutSizeFittingSize:target
                          withHorizontalFittingPriority:wm == MeasureMode::Exactly ? UILayoutPriorityRequired
                                                                                   : UILayoutPriorityFittingSizeLevel
                                verticalFittingPriority:hm == MeasureMode::Exactly ? UILayoutPriorityRequired
                                                                                   : UILayoutPriorityFittingSizeLevel];
  view.translatesAutoresizingMaskIntoConstraints = translated;

  return fits;
}

/// What a measure gives Yoga: exactly what it was told, at most its bound.
float bounded(CGFloat size, float bound, MeasureMode mode) {
  if (mode == MeasureMode::Exactly) return bound;
  if (mode == MeasureMode::AtMost) return std::min(static_cast<float>(size), bound);
  return static_cast<float>(size);
}

}  // namespace

@implementation LucentFlexView {
  std::shared_ptr<LayoutNode> _node;
  std::vector<FlexChild> _children;
  std::weak_ptr<lucent::ui::Content> _content;
  size_t _listener;
}

- (instancetype)initWithNode:(std::shared_ptr<LayoutNode>)node content:(std::weak_ptr<lucent::ui::Content>)content {
  if (!(self = [super initWithFrame:CGRectZero])) return nil;

  _node = std::move(node);
  _content = content;

  __weak LucentFlexView* weakSelf = self;
  _node->onDirtied([weakSelf] { [weakSelf setNeedsLayout]; });

  // The mount's code may have changed what any leaf shows: the tree's root measures them all again.
  if (auto c = content.lock())
    _listener = c->listen([weakSelf] {
      LucentFlexView* flex = weakSelf;
      if (flex && !flex->_node->parent()) flex->_node->dirtyLeaves();
    });

  return self;
}

- (void)dealloc {
  if (auto c = _content.lock()) c->unlisten(_listener);
  _node->onDirtied(nullptr);
}

- (void)lucentInsert:(const FlexChild&)child at:(int)index {
  _node->insert(child.node, static_cast<size_t>(index));
  _children.insert(_children.begin() + index, child);
  [self insertSubview:lucent::objc::unwrap(child.view) atIndex:index];
}

- (void)lucentRemove:(const FlexChild&)child {
  auto at = std::find_if(_children.begin(), _children.end(), [&](const FlexChild& c) { return c.node == child.node; });
  if (at == _children.end()) return;

  _node->remove(child.node);
  _children.erase(at);
  [lucent::objc::unwrap(child.view) removeFromSuperview];
}

- (void)layoutSubviews {
  [super layoutSubviews];

  // The outermost Flex lays the tree out; each writes its own children's frames.
  if (!_node->parent()) {
    _node->setPointScale(static_cast<float>(scaleOf(self)));
    _node->calculate(self.bounds.size.width, self.bounds.size.height, directionOf(self));
  }

  for (auto& child : _children) {
    const auto f = child.node->frame();
    UIView* view = lucent::objc::unwrap(child.view);

    view.frame = CGRectMake(f.x, f.y, f.width, f.height);
    if ([view isKindOfClass:LucentFlexView.class]) [view setNeedsLayout];
  }
}

- (CGSize)sizeThatFits:(CGSize)size {
  // Inside another Flex, the tree's root decides.
  if (_node->parent()) return self.bounds.size;

  _node->setPointScale(static_cast<float>(scaleOf(self)));
  const auto fits = _node->fit(boundOf(size.width), boundOf(size.height), directionOf(self));

  // Measuring laid the tree out at another size: the next layout lays it out at the bounds.
  [self setNeedsLayout];
  return CGSizeMake(fits.width, fits.height);
}

@end

namespace lucent::ui::flex {

FlexChild container(const std::weak_ptr<Content>& content) {
  auto node = LayoutNode::create();
  LucentFlexView* view = [[LucentFlexView alloc] initWithNode:node content:content];

  return {objc::wrap(view, "<Flex>"), node};
}

FlexChild leaf(const NativeRef& view) {
  auto node = LayoutNode::create();
  __weak UIView* weakView = objc::unwrap(view);

  node->measureWith([weakView](float width, MeasureMode wm, float height, MeasureMode hm) {
    UIView* v = weakView;
    if (!v) return LayoutSize{0, 0};

    const CGSize s = measured(v, width, wm, height, hm);
    return LayoutSize{bounded(s.width, width, wm), bounded(s.height, height, hm)};
  });

  return {view, node};
}

ChildOps<FlexChild> ops(const FlexChild& parent) {
  const NativeRef view = parent.view;

  return {
      [view](const FlexChild& child, int index) { [(LucentFlexView*)objc::unwrap(view) lucentInsert:child at:index]; },
      [view](const FlexChild& child) { [(LucentFlexView*)objc::unwrap(view) lucentRemove:child]; },
      nullptr,
  };
}

}  // namespace lucent::ui::flex
