// Built only when the app's Lucent code has components (their Fabric
// sources are generated): the rest of the time React Native's view classes
// stay out of the Lucent pod.
#if __has_include(<views/lucent_views.h>)

#import "LucentComponentView.h"

#import <React/RCTComponentViewFactory.h>
#import <React/RCTUtils.h>
#import <react/utils/FollyConvert.h>

#include <lucent/component_view.h>
#include <lucent/execution.h>
#include <lucent/platform/ios.h>
#include <lucent/report.h>
#include <lucent/view.h>

#include <algorithm>
#include <cmath>
#include <exception>
#include <utility>

#import "LucentViewChildren.h"
#include "LucentViewSizing.h"
#include "LucentViewSlots.h"

namespace lucent::views {

bool HostView::current() const {
  LucentComponentView* view = view_;

  return view != nil && view.lucentToken == token_;
}

std::shared_ptr<const facebook::react::EventEmitter> HostView::emitter() const {
  LucentComponentView* view = view_;

  return view != nil && view.lucentToken == token_ ? view.lucentEventEmitter : nullptr;
}

lucent::NativeRef HostView::slot() const {
  LucentComponentView* view = view_;
  UIView* slot = view != nil && view.lucentToken == token_ ? view.lucentSlot : nil;

  return slot ? lucent::objc::wrap(slot, "the slot of a component's children") : lucent::NativeRef();
}

}  // namespace lucent::views

namespace {

/** Runs `work` in Lucent's main context, reporting what it throws as `where`. */
template <class F>
void inMainContext(const char* where, F&& work) {
  // Nothing escapes into UIKit, entering the context included.
  try {
    lucent::ContextEntry entry(lucent::ExecutionContext::main());

    work();
  } catch (...) {
    lucent::reportUncaught(std::current_exception(), where);
  }
}

}  // namespace

@implementation LucentComponentView {
  std::unique_ptr<lucent::views::Mounted> _mounted;
  lucent::views::MountToken _token;
  /// The props of the latest commit, and of the one the mount has.
  facebook::react::Props::Shared _committed;
  facebook::react::Props::Shared _applied;
  lucent::views::HostSizing _sizing;
  /// React Native's children of the component, and the mount's slot for them.
  LucentChildren *_children;
  /// Where the slot is, as the shadow tree lays the children out (LucentViewSlots.h).
  lucent::views::HostSlot _place;
  /// The mount's UIKit view controller whose preferred content size the host follows.
  UIViewController *_followed;
}

/** What the host's observation of a controller's preferredContentSize is told with. */
static void *LucentPreferredSizeContext = &LucentPreferredSizeContext;

- (instancetype)initWithFrame:(CGRect)frame
{
  if (self = [super initWithFrame:frame]) {
    [[NSNotificationCenter defaultCenter] addObserver:self
                                             selector:@selector(lucentContentSizeCategoryChanged:)
                                                 name:UIContentSizeCategoryDidChangeNotification
                                               object:nil];
  }

  return self;
}

// The text size the user chose changed: content that follows it (Dynamic
// Type) changed size with no Lucent code running, and React Native lays
// nothing out again for it until something else changes. Measured on the
// next turn, once UIKit has updated the content's fonts.
- (void)lucentContentSizeCategoryChanged:(NSNotification *)notification
{
  __weak LucentComponentView *weakSelf = self;

  dispatch_async(dispatch_get_main_queue(), ^{
    LucentComponentView *view = weakSelf;

    if (view && view->_mounted) view->_sizing.contentChanged();
  });
}

+ (void)lucentRegister:(Class)componentViewClass
{
  [[RCTComponentViewFactory currentComponentViewFactory] registerComponentViewClass:componentViewClass];
}

+ (BOOL)lucentTakesChildren
{
  return NO;
}

- (lucent::views::MountToken)lucentToken
{
  return _token;
}

- (UIView *)lucentSlot
{
  return _children.slot;
}

- (LucentChildren *)lucentChildren
{
  if (!_children) {
    __weak LucentComponentView *weakSelf = self;

    _children = [[LucentChildren alloc] initWithHost:self
                                               name:@([[self class] componentDescriptorProvider].name)
                                      takesChildren:[[self class] lucentTakesChildren]
                                             placed:^{ [weakSelf placeSlot]; }];
  }

  return _children;
}

/** Where the slot now is in the content box Yoga laid the component out with, for the shadow tree. */
- (void)placeSlot
{
  UIView *slot = _children.slot;
  UIView *parent = slot.superview;

  if (!_mounted || !parent || ![slot isDescendantOfView:self]) return;

  auto rect = [](auto r) {
    return lucent::slots::Rect{
        static_cast<float>(r.origin.x),
        static_cast<float>(r.origin.y),
        static_cast<float>(r.size.width),
        static_cast<float>(r.size.height)};
  };

  _place.place(
      lucent::slots::insetsOf(rect([parent convertRect:slot.frame toView:self]), rect(_layoutMetrics.getContentFrame())),
      _layoutMetrics.layoutDirection == facebook::react::LayoutDirection::RightToLeft,
      _layoutMetrics.wasLeftAndRightSwapped);
}

// React Native's children go in the mount's slot (LucentViewChildren.h), never
// in the host view beside the component's content.
- (void)mountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  [self.lucentChildren mount:childComponentView index:index];
}

- (void)unmountChildComponentView:(UIView<RCTComponentViewProtocol> *)childComponentView index:(NSInteger)index
{
  [self.lucentChildren unmount:childComponentView index:index];
}

- (void)layoutSubviews
{
  [super layoutSubviews];

  // The content may have moved the slot within the host.
  [_children.slot setNeedsLayout];
  // And the content within the host, under its safe area.
  [self removeSafeArea];
}

- (std::shared_ptr<const facebook::react::EventEmitter>)lucentEventEmitter
{
  return _eventEmitter;
}

- (std::unique_ptr<lucent::views::Mounted>)lucentMount:(const facebook::react::Props &)props
                                                   host:(lucent::views::HostView)host
{
  [NSException raise:NSInternalInconsistencyException
              format:@"%@ does not implement lucentMount:host:", NSStringFromClass([self class])];
  return nullptr;
}

- (std::optional<double>)lucentRequestId:(const std::string &)name args:(const folly::dynamic &)args
{
  return std::nullopt;
}

- (void)updateProps:(const facebook::react::Props::Shared &)props
           oldProps:(const facebook::react::Props::Shared &)oldProps
{
  [super updateProps:props oldProps:oldProps];

  _committed = props;
}

- (void)updateState:(const facebook::react::State::Shared &)state
           oldState:(const facebook::react::State::Shared &)oldState
{
  [super updateState:state oldState:oldState];

  _sizing.setState(state);
  _place.setState(state);
}

// A commit's updates all reached the view: mount, or apply the commit to
// the mount, now that it is committed and on the main thread (entering
// the mount, the content is measured again once it ran); then measure it
// if the commit's state asks for new constraints.
- (void)finalizeUpdates:(RNComponentViewUpdateMask)updateMask
{
  [super finalizeUpdates:updateMask];

  if (_committed && _committed != _applied) {
    if (!_mounted) {
      [self mountWithProps:_committed];
    } else {
      auto previous = _applied;

      inMainContext("a component's update", [&] {
        lucent::ui::ContentEntry entry(_sizing.content());

        _mounted->update(*_committed, *previous);
      });
      _place.contentChanged();
      [_children contentChanged];
    }

    _applied = _committed;
    [self showMountedView];
  }

  _sizing.measure();
}

- (void)updateLayoutMetrics:(const facebook::react::LayoutMetrics &)layoutMetrics
           oldLayoutMetrics:(const facebook::react::LayoutMetrics &)oldLayoutMetrics
{
  [super updateLayoutMetrics:layoutMetrics oldLayoutMetrics:oldLayoutMetrics];
  [_children.slot setNeedsLayout];

  if (layoutMetrics.layoutDirection != oldLayoutMetrics.layoutDirection) [self applyLayoutDirection];

  if (lucent::views::sizingTraced()) {
    auto frame = layoutMetrics.frame.size;
    auto content = self.contentView.frame.size;

    lucent::views::traceSizing(
        "%d frame %gx%g content %gx%g", static_cast<int>(self.tag), frame.width, frame.height, content.width, content.height);
  }
}

/**
 * The mount's view's size within `constraints` (sizeThatFits:), or nothing
 * without one. A UIKit view controller's is its preferred content size, if
 * it has one: else its style or flex sizes it.
 */
- (std::optional<lucent::sizing::Size>)lucentMeasure:(lucent::sizing::Constraints)constraints
{
  if (_mounted && _mounted->plainController()) {
    CGSize preferred = _mounted->controller().preferredContentSize;

    if (preferred.width <= 0 && preferred.height <= 0) return std::nullopt;

    return lucent::sizing::Size{
        std::min(static_cast<float>(preferred.width), constraints.maxWidth),
        std::min(static_cast<float>(preferred.height), constraints.maxHeight)};
  }

  UIView *content = _mounted ? _mounted->view() : nil;

  if (!content) return std::nullopt;

  auto bound = [](float value) { return std::isinf(value) ? CGFLOAT_MAX : static_cast<CGFloat>(value); };
  CGSize fits = [content sizeThatFits:CGSizeMake(bound(constraints.maxWidth), bound(constraints.maxHeight))];

  return lucent::sizing::Size{static_cast<float>(fits.width), static_cast<float>(fits.height)};
}

- (void)mountWithProps:(const facebook::react::Props::Shared &)props
{
  _token = lucent::views::MountToken{static_cast<facebook::react::Tag>(self.tag), lucent::views::nextGeneration()};

  __weak LucentComponentView *weakSelf = self;

  _sizing.start(
      static_cast<float>(RCTScreenScale()),
      static_cast<int>(self.tag),
      [weakSelf](lucent::sizing::Constraints constraints) -> std::optional<lucent::sizing::Size> {
        LucentComponentView *view = weakSelf;

        return view ? [view lucentMeasure:constraints] : std::nullopt;
      },
      // The content changed, a native timer's or an animation's code too, not
      // only a commit's or a command's: it may have moved the slot, which lays
      // out again on UIKit's next pass and reports where it is, past the
      // reports' bound (TA26).
      [weakSelf] {
        LucentComponentView *view = weakSelf;

        if (!view) return;

        view->_place.contentChanged();
        [view->_children.slot setNeedsLayout];
      });
  _place.start(static_cast<float>(RCTScreenScale()), static_cast<int>(self.tag));
  [self.lucentChildren startMount];

  // Which view the mount is on: a recycled one keeps its address.
  lucent::views::traceSizing("%d on view %p", static_cast<int>(self.tag), (__bridge void *)self);

  lucent::views::HostView host(self, _token);

#ifndef NDEBUG
  // A debug build's snapshot (__lucentDebug.snapshot()) walks UIKit's views.
  static const bool walker = (lucent::objc::installViewTree(), true);
  (void)walker;
#endif

  inMainContext("a component's setup", [&] {
    lucent::ui::ContentEntry entry(_sizing.content());

    _mounted = [self lucentMount:*props host:host];
  });
  [self followPreferredSize];
  // Where viewOf finds the mount's root, for a module function given the component's ref (T124).
  if (_mounted)
    lucent::ui::recordMount(
        {static_cast<double>(_token.tag), _token.generation}, lucent::objc::wrap(_mounted->view(), "a component's view"));
  [_children mountedContent:_mounted ? _mounted->view() : nil];
}

/**
 * A UIKit view controller tells its parent when its preferred content size
 * changes, and its parent is the screen's, not the host: the host observes
 * it, and measures the content again.
 */
- (void)followPreferredSize
{
  UIViewController *controller = _mounted && _mounted->plainController() ? _mounted->controller() : nil;

  if (controller == _followed) return;

  [self stopFollowingPreferredSize];

  if (!controller) return;

  [controller addObserver:self forKeyPath:@"preferredContentSize" options:0 context:LucentPreferredSizeContext];
  _followed = controller;
}

- (void)stopFollowingPreferredSize
{
  [_followed removeObserver:self forKeyPath:@"preferredContentSize" context:LucentPreferredSizeContext];
  _followed = nil;
}

- (void)observeValueForKeyPath:(NSString *)keyPath
                      ofObject:(id)object
                        change:(NSDictionary<NSKeyValueChangeKey, id> *)change
                       context:(void *)context
{
  if (context != LucentPreferredSizeContext) {
    [super observeValueForKeyPath:keyPath ofObject:object change:change context:context];
    return;
  }

  if (object == _followed) _sizing.contentChanged();
}

/**
 * The mount's view as the content view (none when its setup failed). Its
 * controller, if it has one, becomes a child first, so that it appears
 * with the views around it.
 */
- (void)showMountedView
{
  UIView *view = _mounted ? _mounted->view() : nil;

  [self containController];

  if (self.contentView == view) return;

  self.contentView = view;
  [self applyLayoutDirection];
  [self removeSafeArea];
}

// The window's safe area reaches a UIKit controller's view through the host: what it covers of
// the content goes back out of the controller's, as a SwiftUI body's has none (safeAreaRegions).
- (void)safeAreaInsetsDidChange
{
  [super safeAreaInsetsDidChange];

  [self removeSafeArea];
}

/**
 * A UIKit view controller's safe area insets, taken back out of its own:
 * its view's insets are what the host's cover of it, from where it is in
 * the host, plus the controller's additional insets.
 */
- (void)removeSafeArea
{
  UIViewController *controller = _mounted && _mounted->plainController() ? _mounted->controller() : nil;
  UIView *content = controller ? controller.viewIfLoaded : nil;

  if (!content || content.superview != self) return;

  UIEdgeInsets host = self.safeAreaInsets;
  CGRect frame = content.frame;
  CGRect bounds = self.bounds;
  UIEdgeInsets covered = UIEdgeInsetsMake(
      std::max<CGFloat>(0, host.top - CGRectGetMinY(frame)),
      std::max<CGFloat>(0, host.left - CGRectGetMinX(frame)),
      std::max<CGFloat>(0, host.bottom - (CGRectGetMaxY(bounds) - CGRectGetMaxY(frame))),
      std::max<CGFloat>(0, host.right - (CGRectGetMaxX(bounds) - CGRectGetMaxX(frame))));
  UIEdgeInsets back = UIEdgeInsetsMake(-covered.top, -covered.left, -covered.bottom, -covered.right);

  if (!UIEdgeInsetsEqualToEdgeInsets(controller.additionalSafeAreaInsets, back)) controller.additionalSafeAreaInsets = back;
}

// A view controller above the host now: contained before the content goes
// into a window, so that UIKit calls its viewWillAppear: and viewDidAppear:
// as its parent's (a pushed screen's is called before the screen's views go
// into the window).
- (void)didMoveToSuperview
{
  [super didMoveToSuperview];

  [self containController];
}

// The host's ancestors went under a view controller as they went into the window.
- (void)willMoveToWindow:(UIWindow *)newWindow
{
  [super willMoveToWindow:newWindow];

  if (newWindow) [self containController];
}

/** The nearest view controller above the view, if any. */
- (UIViewController *)lucentParentController
{
  for (UIResponder *r = self.superview; r; r = r.nextResponder)
    if ([r isKindOfClass:[UIViewController class]]) return (UIViewController *)r;

  return nil;
}

/**
 * The mount's controller as a child of the nearest view controller above
 * the host, as soon as there is one, so that its parent's appearance,
 * traits and safe area reach it. It stays that child when the host leaves
 * (a popped screen's views leave the window before its viewDidDisappear:),
 * until the host is under another view controller or the mount ends.
 */
- (void)containController
{
  UIViewController *controller = _mounted ? _mounted->controller() : nil;
  UIViewController *parent = controller ? [self lucentParentController] : nil;

  if (!parent || controller.parentViewController == parent) return;

  [self releaseController:controller];
  [parent addChildViewController:controller];
  [self applyLayoutDirection];
  [controller didMoveToParentViewController:parent];
}

- (void)releaseController:(UIViewController *)controller
{
  if (!controller.parentViewController) return;

  [controller willMoveToParentViewController:nil];
  [controller removeFromParentViewController];
}

/**
 * The host's layout direction (Yoga's, which React Native gives its views
 * as their semantic content attribute) as the controller's trait: SwiftUI
 * lays its content out by the trait alone. Before iOS 17, the parent
 * overrides it for its child, once contained.
 */
- (void)applyLayoutDirection
{
  UIViewController *controller = _mounted ? _mounted->controller() : nil;

  if (!controller) return;

  auto direction = _layoutMetrics.layoutDirection == facebook::react::LayoutDirection::RightToLeft
      ? UITraitEnvironmentLayoutDirectionRightToLeft
      : UITraitEnvironmentLayoutDirectionLeftToRight;

  if (@available(iOS 17.0, *)) {
    controller.traitOverrides.layoutDirection = direction;
  } else {
    [controller.parentViewController setOverrideTraitCollection:[UITraitCollection traitCollectionWithLayoutDirection:direction]
                                          forChildViewController:controller];
  }
}

- (void)handleCommand:(const NSString *)commandName args:(const NSArray *)args
{
  std::string name = commandName.UTF8String;

  folly::dynamic arguments = facebook::react::convertIdToFollyDynamic(args);
  auto requester = lucent::views::Requester::current();

  if (!_mounted) {
    std::string problem = "command " + name + " reached a view with no mount (its setup failed, or it is not mounted yet)";

    // A request would otherwise never settle while the view stays.
    if (auto id = [self lucentRequestId:name args:arguments])
      requester.reject(*id, problem);
    else
      lucent::logError(("[lucent] " + problem).c_str());

    return;
  }

  inMainContext("a component's command", [&] {
    lucent::ui::ContentEntry entry(_sizing.content());

    _mounted->command(name, arguments, requester);
  });

  // A command may move the slot.
  _place.contentChanged();
  [_children contentChanged];
}

// The view goes back to the renderer's pool: its mount ends here, and a
// later occupant gets a mount (and token) of its own.
- (void)prepareForRecycle
{
  UIViewController *controller = _mounted ? _mounted->controller() : nil;
  BOOL contained = controller.parentViewController != nil;

  // Out of its parent in UIKit's order: told, its view gone (disappearing
  // as its parent's child, if in a window), then removed.
  if (contained) [controller willMoveToParentViewController:nil];

  self.contentView = nil;

  if (contained) [controller removeFromParentViewController];

  lucent::ui::forgetMount({static_cast<double>(_token.tag), _token.generation});
  _token = lucent::views::MountToken{};
  [_children endMount];
  // Its teardown runs the mount's code: nothing to measure any more.
  [self stopFollowingPreferredSize];
  _sizing.stop();

  auto mounted = std::move(_mounted);

  inMainContext("a component's teardown", [&] { mounted.reset(); });

  _committed = nullptr;
  _applied = nullptr;
  _place = {};

  [super prepareForRecycle];
}

- (void)dealloc
{
  [self stopFollowingPreferredSize];
  lucent::ui::forgetMount({static_cast<double>(_token.tag), _token.generation});
  _sizing.stop();

  if (_mounted) {
    [self releaseController:_mounted->controller()];

    auto mounted = std::move(_mounted);

    inMainContext("a component's teardown", [&] { mounted.reset(); });
  }
}

@end

#endif
