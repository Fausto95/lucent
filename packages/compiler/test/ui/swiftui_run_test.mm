// The Toggle fixture, a SwiftUI component written in Lucent, in its iOS
// host on Mac Catalyst (UIKit, SwiftUI, React Native's prebuilt view
// classes), driven as React Native's mounting manager drives a component
// view. The app's window stays hidden: its root view controller appears as
// UIKit makes a visible window's appear. Steps: mounted, then shown in a
// window, where its hosting controller is its parent's child and appears
// with it, and VoiceOver reads its body; the parent's traits and the host's layout direction; props,
// commands and the body's actions reaching SwiftUI (the size it measures);
// its size reports; its parent disappearing and appearing again; a pushed
// screen, popped; the view leaving the window and coming back; recycled
// (its controller and model go, a late action or size report does
// nothing) and mounted again; two at once; the hosts going while mounted.
// Prints one line per step; swiftui-run.test.ts compares them.
#import <React/RCTViewComponentView.h>
#import <UIKit/UIKit.h>
#import <objc/runtime.h>

#include <views/TOGGLE.h>

#include <folly/json.h>
#include <lucent/native.h>
#include <react/renderer/core/LayoutMetrics.h>
#include <react/renderer/core/RawPropsParser.h>
#include <react/utils/ContextContainer.h>

#include <dlfcn.h>

#include <cstdio>
#include <memory>
#include <string>
#include <vector>

#import "LucentComponentView.h"

namespace react = facebook::react;
namespace toggle = lucent::views::TOGGLE;

/// Calls action `index` of the SwiftUI component's body, as its callbacks do (swiftui_run_probe.swift).
extern "C" void lucent_test_act(void* controller, int32_t index);

/** A view controller that counts its children's size reports (preferredContentSize). */
@interface LucentTestParent : UIViewController
@property (nonatomic) int sizeReports;
@end

@implementation LucentTestParent
- (void)preferredContentSizeDidChangeForChildContentContainer:(id<UIContentContainer>)container
{
  self.sizeReports++;
  [super preferredContentSizeDidChangeForChildContentContainer:container];
}
@end

namespace {

void say(const std::string& line) {
  std::printf("%s\n", line.c_str());
  std::fflush(stdout);
}

/** Lets the main thread run what comes due (layout, posted work, releases) for `ms` milliseconds. */
void pump(double ms) { [[NSRunLoop mainRunLoop] runUntilDate:[NSDate dateWithTimeIntervalSinceNow:ms / 1000]]; }

std::shared_ptr<const toggle::Props> commit(const char* json) {
  static react::RawPropsParser parser = [] {
    react::RawPropsParser p;
    p.prepare<toggle::Props>();
    return p;
  }();
  react::ContextContainer container;
  react::PropsParserContext context{-1, container};
  react::RawProps raw(folly::parseJson(json));

  raw.parse(parser);

  return std::make_shared<const toggle::Props>(context, toggle::Props(), raw);
}

/** The first state of a view, as the renderer makes it: updates posted to it go nowhere (no renderer). */
react::State::Shared initialState(const react::Props::Shared& props, react::Tag tag) {
  static toggle::ComponentDescriptor descriptor(
      react::ComponentDescriptorParameters{.eventDispatcher = {}, .contextContainer = nullptr, .flavor = nullptr});
  // Kept: a state holds its family weakly.
  static std::vector<react::ShadowNodeFamily::Shared> families;

  families.push_back(descriptor.createFamily({.tag = tag, .surfaceId = 1, .instanceHandle = nullptr}));

  return descriptor.createInitialState(props, families.back());
}

react::LayoutMetrics metrics(react::LayoutDirection direction) {
  react::LayoutMetrics m;

  m.frame = {{0, 0}, {200, 120}};
  m.layoutDirection = direction;

  return m;
}

/** A new host view (tag `tag`), mounted for `json`'s props as a first commit mounts it. */
LucentComponentView* mounted(react::Tag tag, const char* json) {
  auto* view = (LucentComponentView*)[[NSClassFromString(@"TOGGLEComponentView") alloc] initWithFrame:CGRectZero];
  auto props = commit(json);

  view.tag = tag;
  [view updateState:initialState(props, tag) oldState:nullptr];
  [view updateProps:props oldProps:nullptr];
  [view updateLayoutMetrics:metrics(react::LayoutDirection::LeftToRight) oldLayoutMetrics:react::EmptyLayoutMetrics];
  [view finalizeUpdates:RNComponentViewUpdateMaskAll];

  return view;
}

void update(LucentComponentView* view, const char* json) {
  [view updateProps:commit(json) oldProps:nullptr];
  [view finalizeUpdates:RNComponentViewUpdateMaskProps];
}

/** The hosting controller whose view the host shows: next in its responder chain (SwiftUI's responders between). */
UIViewController* controllerOf(LucentComponentView* view) {
  for (UIResponder* r = view.contentView.nextResponder; r && r != view; r = r.nextResponder)
    if ([r isKindOfClass:[UIViewController class]]) return (UIViewController*)r;

  return nil;
}

/** What the body measures in a 300 pt wide box. */
CGSize measured(LucentComponentView* view) {
  return [view.contentView sizeThatFits:CGSizeMake(300, CGFLOAT_MAX)];
}

/** The appearance calls the hosting controllers got, since the last read. */
std::vector<std::string> appearances;

std::string heard() {
  std::string out;

  for (auto& a : appearances) out += (out.empty() ? "" : " ") + a;

  appearances.clear();

  return out.empty() ? "none" : out;
}

/** Records the appearance calls of `cls`'s controllers (the generated hosting class), then runs UIKit's. */
void observeAppearance(Class cls) {
  static const std::pair<SEL, const char*> calls[] = {
      {@selector(viewWillAppear:), "willAppear"},
      {@selector(viewDidAppear:), "didAppear"},
      {@selector(viewWillDisappear:), "willDisappear"},
      {@selector(viewDidDisappear:), "didDisappear"},
  };

  for (auto [selector, name] : calls) {
    auto inherited = (void (*)(id, SEL, BOOL))class_getMethodImplementation(class_getSuperclass(cls), selector);
    std::string label = name;
    SEL sel = selector;
    IMP imp = imp_implementationWithBlock(^(UIViewController* self, BOOL animated) {
      appearances.push_back(label);
      inherited(self, sel, animated);
    });

    class_addMethod(cls, sel, imp, "v@:B");
  }
}

std::string parentOf(UIViewController* controller) {
  UIViewController* parent = controller.parentViewController;

  return parent ? NSStringFromClass([parent class]).UTF8String : "none";
}

std::string yes(bool b) { return b ? "yes" : "no"; }

/**
 * Turns the app's accessibility on, as a running assistive technology
 * (VoiceOver) does: SwiftUI then publishes its accessibility elements.
 * Private to UIKit's accessibility library; the harness's alone.
 */
void enableAccessibility() {
  auto enable = (void (*)(bool))dlsym(dlopen("/usr/lib/libAccessibility.dylib", RTLD_NOW),
                                      "_AXSApplicationAccessibilitySetEnabled");

  if (enable) enable(true);
}

/** The labels of the accessibility elements under `element`, as VoiceOver finds them. */
void labels(id element, std::string& out) {
  if ([element isAccessibilityElement]) {
    NSString* label = [element accessibilityLabel];

    out += (out.empty() ? "" : ", ") + std::string(label ? label.UTF8String : "(none)");
    return;
  }

  NSArray* elements = [element accessibilityElements];

  for (id e in elements.count ? elements : [element isKindOfClass:[UIView class]] ? [element subviews] : @[])
    labels(e, out);
}

/** The parent view controller of the controller the host shows. */
std::string parentOf(LucentComponentView* view) { return parentOf(controllerOf(view)); }

std::string direction(UIViewController* controller) {
  return controller.traitCollection.layoutDirection == UITraitEnvironmentLayoutDirectionRightToLeft ? "right to left"
                                                                                                    : "left to right";
}

void run(UIWindow* window) {
  const long refs = lucent::liveNativeRefs();

  enableAccessibility();

  // Each step in a pool of its own: what UIKit autoreleases goes as the step ends.
  LucentTestParent* root;
  LucentComponentView* a;
  __weak UIViewController* first;
  __weak UIView* firstView;

  @autoreleasepool {
    root = [LucentTestParent new];
    window.rootViewController = root;
    if (!root.view.window) [window addSubview:root.view];
    root.view.frame = window.bounds;
    // As UIKit makes a visible window's root appear.
    [root beginAppearanceTransition:YES animated:NO];
    [root endAppearanceTransition];

    // Mounted as React Native mounts a new view: before it is in a window.
    a = mounted(10, R"({"p0": "A"})");
    first = controllerOf(a);
    firstView = first.view;
    observeAppearance(object_getClass(first));
    say("mounted: controller " + yes(first) + ", parent " + parentOf(a) + ", appearance " + heard());
  }

  @autoreleasepool {
    [root.view addSubview:a];
    pump(50);
    say("in a window: parent " + parentOf(a) + ", appearance " + heard());
  }

  // What VoiceOver reads: the body's elements, through the host.
  @autoreleasepool {
    std::string read;

    labels(a, read);
    say("accessibility: host an element " + yes([a isAccessibilityElement]) + ", reads " + read);
  }

  @autoreleasepool {
    window.overrideUserInterfaceStyle = UIUserInterfaceStyleDark;
    pump(20);
    say(std::string("dark window: controller ") +
        (first.traitCollection.userInterfaceStyle == UIUserInterfaceStyleDark ? "dark" : "light"));
    window.overrideUserInterfaceStyle = UIUserInterfaceStyleUnspecified;
  }

  @autoreleasepool {
    [a updateLayoutMetrics:metrics(react::LayoutDirection::RightToLeft)
          oldLayoutMetrics:metrics(react::LayoutDirection::LeftToRight)];
    pump(20);
    std::string rtl = direction(first);

    [a updateLayoutMetrics:metrics(react::LayoutDirection::LeftToRight)
          oldLayoutMetrics:metrics(react::LayoutDirection::RightToLeft)];
    pump(20);
    say("host right to left: controller " + rtl + ", back: " + direction(first));
  }

  // What the body shows: a prop's text, the toggle's state.
  @autoreleasepool {
    CGSize before = measured(a);

    update(a, R"({"p0": "A much longer title"})");
    pump(20);

    CGSize titled = measured(a);

    say("prop: " + std::string(titled.width > before.width ? "wider" : "not wider"));

    [a handleCommand:@"toggle" args:@[]];
    pump(20);

    CGSize on = measured(a);

    say("command toggle: " + std::string(on.height != titled.height ? "resized" : "same size"));

    lucent_test_act((__bridge void*)first, 0);
    pump(20);
    say("action: " + std::string(measured(a).height == titled.height ? "off again" : "still on"));

    // SwiftUI reports its ideal size as it lays out: for the host, never the parent.
    first.preferredContentSize = CGSizeMake(before.width + 1, before.height + 1);
    pump(50);
    say("size reports to the parent: " + std::to_string(root.sizeReports));
  }

  // The parent's appearance reaches its children.
  @autoreleasepool {
    [root beginAppearanceTransition:NO animated:NO];
    [root endAppearanceTransition];
    [root beginAppearanceTransition:YES animated:NO];
    [root endAppearanceTransition];
    say("parent disappeared, appeared: " + heard());
  }

  // A screen pushed on a navigation controller, holding a second toggle, then popped.
  LucentComponentView* b;
  __weak UIViewController* pushed;

  @autoreleasepool {
    auto* navigation = [[UINavigationController alloc] initWithRootViewController:[UIViewController new]];

    [root addChildViewController:navigation];
    navigation.view.frame = root.view.bounds;
    [root.view addSubview:navigation.view];
    [navigation didMoveToParentViewController:root];

    auto* screen = [UIViewController new];

    b = mounted(20, R"({"p0": "B"})");
    pushed = controllerOf(b);
    [screen.view addSubview:b];
    [navigation pushViewController:screen animated:NO];
    pump(50);
    say("pushed: parent " + std::string(pushed.parentViewController == screen ? "the screen" : parentOf(b)) +
        ", appearance " + heard());

    [navigation popViewControllerAnimated:NO];
    pump(50);
    say("popped: parent " + std::string(pushed.parentViewController == screen ? "the screen" : parentOf(b)) +
        ", appearance " + heard());
  }

  // Out of the window, and back (a list detaching a row): the same parent throughout.
  @autoreleasepool {
    [a removeFromSuperview];
    pump(20);
    say("removed: parent " + parentOf(a) + ", appearance " + heard());

    [root.view addSubview:a];
    pump(20);
    say("back: parent " + parentOf(a) + ", appearance " + heard());

    [a removeFromSuperview];
    heard();
  }

  // Recycled, as React Native recycles an unmounted view. UIKit may still
  // hold the controller for a while (a transition): what it does then
  // reaches no mount.
  @autoreleasepool {
    UIViewController* held = first;

    [a prepareForRecycle];
    lucent_test_act((__bridge void*)held, 0);
    held.preferredContentSize = CGSizeMake(1, 1);
    [a handleCommand:@"toggle" args:@[]];
    say(std::string("recycled: parent ") + parentOf(held) + ", content " + (a.contentView ? "kept" : "gone") +
        ", late action and report ignored");
  }

  pump(100);
  say(std::string("released: controller ") + (first ? "alive" : "gone") + ", view " + (firstView ? "alive" : "gone"));

  // Mounted again: a new component instance, with its own controller.
  LucentComponentView* c;

  @autoreleasepool {
    update(a, R"({"p0": "A again"})");
    [root.view addSubview:a];
    pump(50);
    say("remounted: new controller " + yes(controllerOf(a) && controllerOf(a) != first) + ", parent " + parentOf(a));

    // Two at once, each its own controller.
    c = mounted(30, R"({"p0": "C"})");
    [root.view addSubview:c];
    pump(50);
    say("two: parents " + parentOf(a) + ", " + parentOf(c) + ", distinct " + yes(controllerOf(c) != controllerOf(a)));
  }

  // Hosts that go while mounted, in the window or not: their controllers go too.
  __weak UIViewController* again;
  __weak UIViewController* third;

  @autoreleasepool {
    again = controllerOf(a);
    third = controllerOf(c);
    [a removeFromSuperview];
    [c removeFromSuperview];
    [b removeFromSuperview];
    a = nil;
    b = nil;
    c = nil;
  }

  pump(100);
  say(std::string("hosts gone: controllers ") + (again || third || pushed ? "alive" : "gone") +
      ", native references " + (lucent::liveNativeRefs() == refs ? "all released" : "held"));
}

}  // namespace

@interface LucentTestScene : UIResponder <UIWindowSceneDelegate>
@property (strong, nonatomic) UIWindow* window;
@end

@implementation LucentTestScene
- (void)scene:(UIScene*)scene willConnectToSession:(UISceneSession*)session options:(UISceneConnectionOptions*)options
{
  self.window = [[UIWindow alloc] initWithWindowScene:(UIWindowScene*)scene];
  self.window.frame = CGRectMake(0, 0, 400, 600);

  // As React Native calls a component view: on the main thread, outside any turn of Lucent's main context.
  dispatch_async(dispatch_get_main_queue(), ^{
    @autoreleasepool {
      run(self.window);
    }

    std::exit(0);
  });
}
@end

@interface LucentTestApp : UIResponder <UIApplicationDelegate>
@end

@implementation LucentTestApp
- (UISceneConfiguration*)application:(UIApplication*)application
    configurationForConnectingSceneSession:(UISceneSession*)session
                                   options:(UISceneConnectionOptions*)options
{
  UISceneConfiguration* configuration = [[UISceneConfiguration alloc] initWithName:@"Test" sessionRole:session.role];

  configuration.delegateClass = [LucentTestScene class];

  return configuration;
}
@end

int main(int argc, char** argv) {
  @autoreleasepool {
    return UIApplicationMain(argc, argv, nil, NSStringFromClass([LucentTestApp class]));
  }
}
