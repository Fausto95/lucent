// Lucent runtime — UIKit glue: UIKit's lifecycle notifications into the
// shared Lifecycle, the presentation context, and showing view controllers.
#include "ios_ui.h"

#import <objc/runtime.h>

#include <array>
#include <string>

using namespace lucent;

namespace {

// --- the notifications, as data -----------------------------------------------------------

struct AppNotification {
  const char* name;
  AppEvent event;
  NSNotificationName __unsafe_unretained notification;
};

struct SceneNotification {
  const char* name;
  SceneEvent event;
  NSNotificationName __unsafe_unretained notification;
};

const std::array<AppNotification, 6>& appNotifications() {
  static const std::array<AppNotification, 6> table = {{
      {"didBecomeActive", AppEvent::DidBecomeActive, UIApplicationDidBecomeActiveNotification},
      {"willResignActive", AppEvent::WillResignActive, UIApplicationWillResignActiveNotification},
      {"didEnterBackground", AppEvent::DidEnterBackground, UIApplicationDidEnterBackgroundNotification},
      {"willEnterForeground", AppEvent::WillEnterForeground, UIApplicationWillEnterForegroundNotification},
      {"didReceiveMemoryWarning", AppEvent::DidReceiveMemoryWarning, UIApplicationDidReceiveMemoryWarningNotification},
      {"willTerminate", AppEvent::WillTerminate, UIApplicationWillTerminateNotification},
  }};
  return table;
}

const std::array<SceneNotification, 6>& sceneNotifications() {
  static const std::array<SceneNotification, 6> table = {{
      {"willConnect", SceneEvent::WillConnect, UISceneWillConnectNotification},
      {"didDisconnect", SceneEvent::DidDisconnect, UISceneDidDisconnectNotification},
      {"didActivate", SceneEvent::DidActivate, UISceneDidActivateNotification},
      {"willDeactivate", SceneEvent::WillDeactivate, UISceneWillDeactivateNotification},
      {"willEnterForeground", SceneEvent::WillEnterForeground, UISceneWillEnterForegroundNotification},
      {"didEnterBackground", SceneEvent::DidEnterBackground, UISceneDidEnterBackgroundNotification},
  }};
  return table;
}

/// The entry of `table` named `name`; TypeError for any other name.
template <class Table>
const auto& named(const Table& table, const String& name, const char* what) {
  std::string wanted = name.toUtf8();
  for (const auto& entry : table)
    if (wanted == entry.name) return entry;

  throw Exception(makeError(String::fromLatin1("TypeError"), String::fromUtf8(std::string("Unknown ") + what + ": " + wanted)));
}

SceneState stateOf(UIScene* scene) {
  // Only window scenes can present.
  if (![scene isKindOfClass:[UIWindowScene class]]) return SceneState::Unattached;

  switch (scene.activationState) {
    case UISceneActivationStateForegroundActive:
      return SceneState::ForegroundActive;
    case UISceneActivationStateForegroundInactive:
      return SceneState::ForegroundInactive;
    case UISceneActivationStateBackground:
      return SceneState::Background;
    default:
      return SceneState::Unattached;
  }
}

void requireMain(const char* what) {
  if (onMainThread()) return;

  throwError(String::fromLatin1("InvalidStateError"), String::fromUtf8(std::string(what) + " is only available on the main thread"));
}

}  // namespace

// --- scenes and their ids -------------------------------------------------------------------

/// Tags a scene with its SceneId. It goes with the scene: if UIKit never
/// said the scene disconnected, its going says so.
@interface LucentSceneTag : NSObject
@property(nonatomic, readonly) SceneId sceneId;
- (instancetype)initWithSceneId:(SceneId)sceneId;
@end

@implementation LucentSceneTag

- (instancetype)initWithSceneId:(SceneId)sceneId {
  if ((self = [super init])) _sceneId = sceneId;
  return self;
}

- (void)dealloc {
  SceneId id = _sceneId;
  lucent::detail::runOn(&ExecutionContext::main(), [id] {
    if (Lifecycle::shared().sceneScope(id)) Lifecycle::shared().report(id, SceneEvent::DidDisconnect);
  });
}

@end

namespace {

char tagKey;

/// Connected scenes by id, held weakly. Main thread.
NSMapTable<NSNumber*, UIScene*>* scenesById() {
  static NSMapTable<NSNumber*, UIScene*>* table = [NSMapTable strongToWeakObjectsMapTable];
  return table;
}

SceneId taggedId(UIScene* scene) {
  LucentSceneTag* tag = objc_getAssociatedObject(scene, &tagKey);
  return tag ? tag.sceneId : 0;
}

/// The scene's id, connecting it first if it has none.
SceneId tag(UIScene* scene) {
  if (SceneId known = taggedId(scene)) return known;

  SceneId id = Lifecycle::shared().connect();
  objc_setAssociatedObject(scene, &tagKey, [[LucentSceneTag alloc] initWithSceneId:id], OBJC_ASSOCIATION_RETAIN_NONATOMIC);
  [scenesById() setObject:scene forKey:@(id)];

  return id;
}

/// Scenes connected before Lucent heard of them.
void adoptConnectedScenes() {
  UIApplication* app = [UIApplication sharedApplication];
  if (!app) return;

  for (UIScene* scene in app.connectedScenes) tag(scene);
}

void sceneNotified(UIScene* scene, SceneEvent event) {
  if (![scene isKindOfClass:[UIScene class]]) return;

  SceneId id = tag(scene);
  Lifecycle::shared().report(id, event);

  if (event != SceneEvent::DidDisconnect) return;

  // Should UIKit connect this object again, it is a new scene.
  [scenesById() removeObjectForKey:@(id)];
  objc_setAssociatedObject(scene, &tagKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

UIWindow* keyWindowOf(UIWindowScene* scene) {
  if (scene.keyWindow) return scene.keyWindow;

  // Not key yet (still activating): its first visible window at the normal level.
  for (UIWindow* window in scene.windows)
    if (!window.hidden && window.windowLevel == UIWindowLevelNormal) return window;

  return nil;
}

UIViewController* topOf(UIViewController* root) {
  UIViewController* top = root;

  while (top.presentedViewController && !top.presentedViewController.isBeingDismissed) top = top.presentedViewController;

  return top;
}

std::optional<objc::PresentationContext> contextOf(SceneId id) {
  auto* scene = (UIWindowScene*)[scenesById() objectForKey:@(id)];
  if (![scene isKindOfClass:[UIWindowScene class]]) return std::nullopt;

  UIWindow* window = keyWindowOf(scene);
  UIViewController* top = topOf(window.rootViewController);
  if (!top) return std::nullopt;

  return objc::PresentationContext{id, scene, window, top};
}

}  // namespace

/// Follows UIKit's lifecycle notifications from the moment the binary loads,
/// before any scene connects, on the main thread (where UIKit posts them;
/// one posted elsewhere is passed there). The observers stay for the
/// process.
@interface LucentLifecycleObserver : NSObject
@end

@implementation LucentLifecycleObserver

+ (void)load {
  NSNotificationCenter* center = [NSNotificationCenter defaultCenter];

  for (const auto& n : sceneNotifications()) {
    SceneEvent event = n.event;
    [center addObserverForName:n.notification
                        object:nil
                         queue:nil
                    usingBlock:^(NSNotification* note) {
                      id scene = note.object;
                      lucent::detail::runOn(&ExecutionContext::main(), [scene, event] { sceneNotified(scene, event); });
                    }];
  }

  for (const auto& n : appNotifications()) {
    AppEvent event = n.event;
    [center addObserverForName:n.notification
                        object:nil
                         queue:nil
                    usingBlock:^(NSNotification*) {
                      lucent::detail::runOn(&ExecutionContext::main(), [event] { Lifecycle::shared().report(event); });
                    }];
  }
}

@end

// --- presenting ----------------------------------------------------------------------------

/// Watches a presented view controller for the person dismissing it (as its
/// presentation controller's delegate, if it had none) and for its release
/// (associated with it), until disarmed.
@interface LucentPresentationWatch : NSObject <UIAdaptivePresentationControllerDelegate>
- (instancetype)initWithDismissed:(std::function<void()>)dismissed;
- (void)disarm;
@end

@implementation LucentPresentationWatch {
  std::function<void()> _dismissed;
}

- (instancetype)initWithDismissed:(std::function<void()>)dismissed {
  if ((self = [super init])) _dismissed = std::move(dismissed);
  return self;
}

- (void)fire {
  std::function<void()> dismissed = std::move(_dismissed);
  _dismissed = nullptr;
  if (dismissed) dismissed();
}

- (void)disarm {
  _dismissed = nullptr;
}

- (void)presentationControllerDidDismiss:(UIPresentationController*)presentationController {
  // Settling may unwatch, releasing this object: keep it until it returns.
  LucentPresentationWatch* watch = self;
  [watch fire];
}

- (void)dealloc {
  [self fire];
}

@end

namespace {

char watchKey;

/// A popover needs an anchor (UIActivityViewController on iPad): the middle
/// of the presenting view, unless the view controller has its own.
void anchorPopover(UIViewController* viewController, UIViewController* from) {
  if (viewController.modalPresentationStyle != UIModalPresentationPopover) return;

  UIPopoverPresentationController* popover = viewController.popoverPresentationController;
  if (!popover || popover.sourceView || popover.barButtonItem) return;
  if (@available(iOS 16.0, *)) {
    if (popover.sourceItem) return;
  }

  CGRect bounds = from.view.bounds;
  popover.sourceView = from.view;
  popover.sourceRect = CGRectMake(CGRectGetMidX(bounds), CGRectGetMidY(bounds), 0, 0);
  popover.permittedArrowDirections = 0;
}

void unwatch(UIViewController* viewController, LucentPresentationWatch* watch) {
  [watch disarm];

  if (viewController.presentationController.delegate == watch) viewController.presentationController.delegate = nil;
  if (objc_getAssociatedObject(viewController, &watchKey) == watch)
    objc_setAssociatedObject(viewController, &watchKey, nil, OBJC_ASSOCIATION_RETAIN_NONATOMIC);
}

[[noreturn]] void refuse(const std::string& why) {
  throwError(String::fromLatin1("InvalidStateError"), String::fromUtf8(why));
}

}  // namespace

namespace lucent::objc {

std::optional<PresentationContext> presentationContext() {
  requireMain("The presentation context");
  adoptConnectedScenes();

  std::optional<SceneId> picked = presentingScene(Lifecycle::shared().scenes(), [](SceneId id) {
    return stateOf([scenesById() objectForKey:@(id)]);
  });

  return picked ? contextOf(*picked) : std::nullopt;
}

SceneId sceneIdOf(UIScene* scene) {
  requireMain("A scene's id");
  return scene ? tag(scene) : 0;
}

UIScene* sceneOf(SceneId id) {
  requireMain("A scene");
  return [scenesById() objectForKey:@(id)];
}

std::function<void()> detail::show(SceneId scene, UIViewController* viewController, bool animated, std::function<void()> dismissed) {
  requireMain("Presenting");

  std::optional<PresentationContext> context = contextOf(scene);
  if (!context) refuse("The scene has no window to present from");

  if (viewController.presentingViewController || viewController.isBeingPresented || viewController.parentViewController ||
      viewController.viewIfLoaded.window)
    refuse("The view controller is already shown");

  // UIKit logs, rather than throws, when it refuses to present during
  // another presentation or dismissal: refuse first.
  UIViewController* top = context->top;
  if (top.presentedViewController || top.isBeingPresented || top.isBeingDismissed) refuse("Another presentation is under way");

  anchorPopover(viewController, top);

  LucentPresentationWatch* watch = [[LucentPresentationWatch alloc] initWithDismissed:std::move(dismissed)];
  objc_setAssociatedObject(viewController, &watchKey, watch, OBJC_ASSOCIATION_RETAIN_NONATOMIC);

  UIPresentationController* controller = viewController.presentationController;
  if (controller && !controller.delegate) controller.delegate = watch;

  // Some view controllers (UIActivityViewController) are shown later than
  // the call, once their content is ready: a dismissal asked for before
  // then waits for it. Main thread only.
  struct Presenting {
    bool shown = false;
    bool withdrawn = false;
  };
  auto presenting = std::make_shared<Presenting>();

  __weak UIViewController* weakViewController = viewController;
  void (^dismiss)(void) = ^{
    UIViewController* shown = weakViewController;
    UIViewController* presenter = shown.presentingViewController;
    if (presenter && !shown.isBeingDismissed) [presenter dismissViewControllerAnimated:animated completion:nil];
  };

  NSString* failure = nil;
  @try {
    [top presentViewController:viewController
                      animated:animated
                    completion:^{
                      presenting->shown = true;
                      if (presenting->withdrawn) dismiss();
                    }];
  } @catch (NSException* e) {
    failure = e.reason ?: e.name;
  }

  if (failure) {
    unwatch(viewController, watch);
    refuse(failure.UTF8String);
  }

  __weak LucentPresentationWatch* weakWatch = watch;
  return [weakViewController, weakWatch, presenting, dismiss] {
    presenting->withdrawn = true;

    UIViewController* shown = weakViewController;
    LucentPresentationWatch* watching = weakWatch;
    if (shown && watching) unwatch(shown, watching);

    if (presenting->shown) dismiss();
  };
}

Error detail::dismissedError() {
  return makeError(String::fromLatin1("AbortError"), String::fromLatin1("The view controller was dismissed"));
}

std::shared_ptr<Scope> detail::callerScope() { return ExecutionContext::of(ExecutionContext::currentRef()).root(); }

namespace {

/// A subscription as the function that ends it, also ended by `signal`.
Fn<void()> stopper(std::shared_ptr<Resource> subscription, Opt<AbortSignal> signal) {
  AbortSignal abort = signal.has() ? signal.get() : nullptr;
  uint64_t listener = 0;

  if (abort) {
    std::weak_ptr<Resource> weak = subscription;
    listener = abort->add([weak] {
      if (auto s = weak.lock()) s->close();
    });
  }

  std::weak_ptr<AbortSignalObject> weakSignal = abort;
  return Fn<void()>([subscription, weakSignal, listener] {
    subscription->close();
    if (auto s = weakSignal.lock(); s && listener) s->remove(listener);
  });
}

bool abortedAlready(const Opt<AbortSignal>& signal) { return signal.has() && signal.get() && signal.get()->aborted.load(); }

/// The session's persistent identifier of a connected scene, else "".
String identifierOf(SceneId id) {
  NSString* identifier = [scenesById() objectForKey:@(id)].session.persistentIdentifier;
  return identifier ? fromNSString(identifier, "persistentIdentifier") : String();
}

}  // namespace

Fn<void()> onAppEvent(const String& event, Fn<void()> listener, Opt<AbortSignal> signal) {
  AppEvent e = named(appNotifications(), event, "app event").event;
  if (abortedAlready(signal)) return Fn<void()>([] {});

  auto subscription = Lifecycle::shared().subscribe(
      e, [listener] { callNow([&] { listener(); }); }, detail::callerScope());

  return stopper(std::move(subscription), signal);
}

Fn<void()> onSceneEvent(const String& event, Fn<void(String)> listener, Opt<AbortSignal> signal) {
  SceneEvent e = named(sceneNotifications(), event, "scene event").event;
  if (abortedAlready(signal)) return Fn<void()>([] {});

  auto subscription = Lifecycle::shared().subscribe(
      e,
      [listener](SceneId scene) {
        String identifier = identifierOf(scene);
        callNow([&] { listener(identifier); });
      },
      detail::callerScope());

  return stopper(std::move(subscription), signal);
}

}  // namespace lucent::objc
