// Lucent runtime — the iOS host of Lucent components in React Native's
// Fabric renderer.
//
// Each component's generated `<registration>ComponentView` derives from
// LucentComponentView, which does what every component's host does: it
// mounts the component when a commit reaches the view on the main thread
// (never while React renders or the renderer builds shadow trees), gives the
// mount a token, hands later commits and commands to it, and ends it when
// the view is recycled. The setup's view fills the host's content box, and
// the host measures it for a component with no size of its own
// (LucentViewSizing.h). The React children React Native mounts in the view
// go in the slot the host makes for each mount of a component taking them,
// never beside the content (LucentViewChildren.h), and the host reports
// where that slot is, for Yoga to lay them out in it (LucentViewSlots.h). A
// view that comes with its controller (a SwiftUI component's) has the
// controller contained in the nearest view controller above the host, as
// soon as there is one, until the mount ends, and laid out in the host's
// direction. The generated subclass provides the renderer's descriptor and
// the component's Lucent side (a Mounted).
//
// Everything runs on the main thread, in Lucent's main context.
#pragma once

#import <React/RCTViewComponentView.h>

#include <folly/dynamic.h>
#include <react/renderer/core/EventEmitter.h>
#include <react/renderer/core/Props.h>

#include <lucent/native.h>

#include <memory>
#include <optional>
#include <string>

#include "LucentViewRequests.h"
#include "LucentViews.h"

@class LucentComponentView;

namespace lucent::views {

/**
 * One mount of a component on its host view: the component's Mount (its
 * compiled setup, run once), as generated code adapts it for each
 * component. Destroying it disposes the mount.
 */
class Mounted {
 public:
  virtual ~Mounted() = default;

  /// The view the component's setup returned.
  virtual UIView* view() const = 0;

  /// The controller whose view view() is, which the host contains in the
  /// nearest view controller above it (a SwiftUI component's hosting
  /// controller); nil for a plain view.
  virtual UIViewController* controller() const { return nil; }

  /// Applies a later commit's props (the component's own Props type): what
  /// changed reaches setup's signals; setup does not run again.
  virtual void update(const facebook::react::Props& props, const facebook::react::Props& previous) = 0;

  /// Runs command `name`; a request answers through `requester`.
  virtual void command(const std::string& name, const folly::dynamic& args, const Requester& requester) = 0;
};

/** What a mount knows of its host view. Main thread. */
class HostView {
 public:
  HostView() = default;
  HostView(LucentComponentView* view, MountToken token) : view_(view), token_(token) {}

  const MountToken& token() const { return token_; }

  /// Whether the view still holds this mount (not recycled or remounted).
  bool current() const;

  /// The event emitter of the view's current commit while the view holds
  /// this mount; else null, and events are dropped.
  std::shared_ptr<const facebook::react::EventEmitter> emitter() const;

  /// The view the host made for this mount's React children (a component
  /// taking them), while the view holds this mount; else empty.
  lucent::NativeRef slot() const;

 private:
  __weak LucentComponentView* view_;
  MountToken token_;
};

}  // namespace lucent::views

@interface LucentComponentView : RCTViewComponentView

/// The token of the mount the view holds, or a zero generation.
@property (nonatomic, readonly) lucent::views::MountToken lucentToken;

/// The event emitter of the view's current commit.
@property (nonatomic, readonly) std::shared_ptr<const facebook::react::EventEmitter> lucentEventEmitter;

/// Registers a component's view class with React Native's component view
/// factory: generated classes call it as they load.
+ (void)lucentRegister:(Class)componentViewClass;

/// Whether the component takes React children: its host then makes a slot
/// for them with each mount (implemented by each component taking them).
+ (BOOL)lucentTakesChildren;

/// The slot of the mount the view holds, or nil.
@property (nonatomic, readonly) UIView *lucentSlot;

/// The request id a command carries, if it is a request (implemented by
/// each component with commands).
- (std::optional<double>)lucentRequestId:(const std::string &)name args:(const folly::dynamic &)args;

/// Implemented by each component: sets it up for `props` on this view.
- (std::unique_ptr<lucent::views::Mounted>)lucentMount:(const facebook::react::Props &)props
                                                   host:(lucent::views::HostView)host;

@end
