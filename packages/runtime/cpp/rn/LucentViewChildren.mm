// Lucent runtime — a component's React children and slot on iOS (see
// LucentViewChildren.h). Built only when the app's Lucent code has
// components, as their host is.
#if __has_include(<views/lucent_views.h>)

#import "LucentViewChildren.h"

#include <lucent/report.h>

#include <string>

namespace {

/** Reports what went wrong with a component's children: nothing throws into UIKit. */
void report(NSString *message)
{
  lucent::logError((std::string("[lucent] ") + message.UTF8String).c_str());
}

}  // namespace

@implementation LucentSlotView {
  __weak UIView *_host;
  void (^_placed)(void);
}

- (instancetype)initWithHost:(UIView *)host placed:(void (^)(void))placed
{
  if ((self = [super initWithFrame:CGRectZero])) {
    _host = host;
    _placed = [placed copy];
    self.clipsToBounds = YES;
    // Follows the view it fills as that view resizes.
    self.autoresizingMask = UIViewAutoresizingFlexibleWidth | UIViewAutoresizingFlexibleHeight;
  }

  return self;
}

// Unsized when setup adds it: it fills the view it is added to.
- (void)didMoveToSuperview
{
  [super didMoveToSuperview];

  UIView *parent = self.superview;

  if (parent && CGRectIsEmpty(self.frame)) self.frame = parent.bounds;

  [self setNeedsLayout];
}

- (void)setFrame:(CGRect)frame
{
  [super setFrame:frame];
  [self setNeedsLayout];
}

- (void)setCenter:(CGPoint)center
{
  [super setCenter:center];
  [self setNeedsLayout];
}

- (void)layoutSubviews
{
  [super layoutSubviews];
  [self lucentAlign];

  if (_placed) _placed();
}

- (void)lucentAlign
{
  UIView *host = _host;
  UIView *parent = self.superview;

  if (!host || !parent || ![self isDescendantOfView:host]) return;

  CGPoint origin = [parent convertPoint:self.frame.origin toView:host];
  CGRect bounds = self.bounds;

  if (CGPointEqualToPoint(bounds.origin, origin)) return;

  bounds.origin = origin;
  self.bounds = bounds;
}

@end

@implementation LucentChildren {
  __weak UIView *_host;
  NSString *_name;
  BOOL _takesChildren;
  void (^_placed)(void);
  /// React Native's children of the component, in its order.
  NSMutableArray<UIView *> *_children;
  /// Whether children given to a component taking none were reported.
  BOOL _refused;
}

- (instancetype)initWithHost:(UIView *)host
                        name:(NSString *)name
               takesChildren:(BOOL)takesChildren
                      placed:(void (^)(void))placed
{
  if ((self = [super init])) {
    _host = host;
    _name = [name copy];
    _takesChildren = takesChildren;
    _placed = [placed copy];
    _children = [NSMutableArray new];
  }

  return self;
}

- (void)mount:(UIView *)child index:(NSInteger)index
{
  NSInteger count = static_cast<NSInteger>(_children.count);

  if (index < 0 || index > count) {
    report([NSString stringWithFormat:@"%@: React Native mounted a child at %ld of %ld", _name, (long)index, (long)count]);
    index = index < 0 ? 0 : count;
  }

  [_children insertObject:child atIndex:static_cast<NSUInteger>(index)];

  if (!_takesChildren && !_refused) {
    _refused = YES;
    report([NSString stringWithFormat:@"%@ takes no React children: React Native gave it %lu, which it does not show",
                                      _name,
                                      (unsigned long)_children.count]);
  }

  [self place:child];
}

- (void)unmount:(UIView *)child index:(NSInteger)index
{
  NSUInteger at = index >= 0 && static_cast<NSUInteger>(index) < _children.count && _children[index] == child
      ? static_cast<NSUInteger>(index)
      : [_children indexOfObjectIdenticalTo:child];

  if (at == NSNotFound) {
    report([NSString stringWithFormat:@"%@: React Native unmounted a child it never mounted here", _name]);
    return;
  }

  [_children removeObjectAtIndex:at];

  // Out of the slot it was put in (an earlier mount's, if React Native kept it past a recycle).
  if ([child.superview isKindOfClass:[LucentSlotView class]]) [child removeFromSuperview];
}

- (void)startMount
{
  _slot = _takesChildren ? [[LucentSlotView alloc] initWithHost:_host placed:_placed] : nil;

  for (UIView *child in _children) [self place:child];
}

- (void)mountedContent:(UIView *)content
{
  if (_slot && content && ![_slot isDescendantOfView:content])
    report([NSString stringWithFormat:@"%@'s setup did not put its slot in the view it returned: its React children do not show",
                                      _name]);
}

- (void)contentChanged
{
  [_slot setNeedsLayout];
}

- (void)endMount
{
  // React Native unmounts a view's children before it recycles the view: any left stay where they are.
  if (_children.count)
    report([NSString stringWithFormat:@"%@ was recycled holding %lu React children: they stay where React Native left them",
                                      _name,
                                      (unsigned long)_children.count]);

  [_children removeAllObjects];
  _slot = nil;
  _refused = NO;
}

/** Puts `child` in the slot, below the next child there: React Native's order. */
- (void)place:(UIView *)child
{
  if (!_slot || child.superview == _slot) return;

  if (child.superview) {
    report([NSString stringWithFormat:@"%@: a React child is in another view: React Native keeps it there", _name]);
    return;
  }

  NSUInteger at = [_children indexOfObjectIdenticalTo:child];

  for (NSUInteger i = at + 1; i < _children.count; i++) {
    if (_children[i].superview == _slot) {
      [_slot insertSubview:child belowSubview:_children[i]];
      return;
    }
  }

  [_slot addSubview:child];
}

@end

#endif
