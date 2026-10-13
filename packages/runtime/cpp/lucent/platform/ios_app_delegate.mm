// Lucent runtime — LucentAppDelegate (what the delegates forward) and
// module code's subscriptions to it (ios_app_delegate.h). Objective-C++
// with ARC, iOS only.
#import "LucentAppDelegate.h"

#import <objc/message.h>
#import <objc/runtime.h>

#include "ios_app_delegate.h"

#include <algorithm>
#include <cstring>
#include <memory>
#include <vector>

#include "../native.h"
#include "ios_ui.h"

// The app's generated lucent_entries.cpp: starts module state for the launch
// modules packages list (lucent.json's launch), or does nothing.
extern "C" void lucent_launch(void);

/// UNUserNotificationCenter's delegate while a module listens for
/// notifications: it reports them to Lucent modules, and forwards every
/// call to the delegate the app had (`next`, which the center held weakly
/// too), merging their answers as Expo's notifications module merges its
/// delegates': the presentation options all asked for. Made at the first
/// subscription, on the main thread, after the app set its own delegate at
/// launch; one the app sets later replaces it. It reads UserNotifications'
/// objects by key, so the runtime links nothing more.
@interface LucentNotificationDelegate : NSObject
@property(nonatomic, weak) id next;
@end

namespace lucent::objc {

AppDelegateEvents& AppDelegateEvents::shared() {
  // Never destroyed: UIKit may call a delegate method while the process exits.
  static auto* events = new AppDelegateEvents();
  return *events;
}

FetchResult fetchResultNamed(const String& name) {
  if (name == String::fromLatin1("newData")) return FetchResult::NewData;
  if (name == String::fromLatin1("failed")) return FetchResult::Failed;
  return FetchResult::NoData;
}

namespace {

/// `value` as JSON can hold it: dictionaries with string keys, arrays,
/// strings, numbers and null as they are; anything else as its description.
id jsonable(id value) {
  if (!value || value == [NSNull null] || [value isKindOfClass:[NSString class]] || [value isKindOfClass:[NSNumber class]])
    return value ?: [NSNull null];
  if ([value isKindOfClass:[NSDictionary class]]) {
    NSMutableDictionary* out = [NSMutableDictionary dictionary];
    [(NSDictionary*)value enumerateKeysAndObjectsUsingBlock:^(id key, id v, BOOL*) {
      out[[key description]] = jsonable(v);
    }];
    return out;
  }
  if ([value isKindOfClass:[NSArray class]]) {
    NSMutableArray* out = [NSMutableArray array];
    for (id v in (NSArray*)value) [out addObject:jsonable(v)];
    return out;
  }
  if ([value isKindOfClass:[NSURL class]]) return [(NSURL*)value absoluteString];
  return [value description];
}

String stringOf(NSString* s) { return s ? fromNSString(s, "a delegate's string") : String(); }

/// The subscriber's actor, and its subscription as the function that ends it.
template <class P, class A, class L>
Fn<void()> subscribeTo(DelegateEvent<P, A>& event, Opt<AbortSignal> signal, L listener) {
  if (detail::abortedAlready(signal)) return Fn<void()>([] {});
  Actor* actor = &currentActor();
  auto subscription = event.subscribe([actor, listener](const P& payload) -> A { return listener(*actor, payload); },
                                      detail::callerScope());
  return detail::stopper(std::move(subscription), signal);
}

/// A fetch's answer from module code's promise, given once it settles: a
/// rejected one, or a listener that throws, failed.
void answerWith(const std::function<void(FetchResult)>& reply, const Promise<String>& answer) {
  answer.onSettled([reply, answer] { reply(answer.fulfilled() ? fetchResultNamed(answer.value()) : FetchResult::Failed); });
}

/// What module code's listeners answer, for a fetch UIKit waits on: the
/// listeners reply later, and `completion` runs once, on the main thread,
/// with their merge, or at UIKit's 30-second limit with what came.
std::shared_ptr<FetchAnswers> fetchAnswers(void (^completion)(UIBackgroundFetchResult)) {
  auto answers = FetchAnswers::start([completion](FetchResult merged) {
    dispatch_async(dispatch_get_main_queue(), ^{
      completion(static_cast<UIBackgroundFetchResult>(merged));
    });
  });
  std::weak_ptr<FetchAnswers> weak = answers;
  dispatch_after(dispatch_time(DISPATCH_TIME_NOW, 25 * NSEC_PER_SEC), dispatch_get_main_queue(), ^{
    if (auto a = weak.lock()) a->expire();
  });
  return answers;
}

/// What Info.plist lets the app turn to, for this device (UIKit's own
/// default when it says nothing).
UIInterfaceOrientationMask infoPlistOrientations() {
  NSDictionary* info = NSBundle.mainBundle.infoDictionary;
  const bool pad = UIDevice.currentDevice.userInterfaceIdiom == UIUserInterfaceIdiomPad;
  NSArray* names = (pad ? info[@"UISupportedInterfaceOrientations~ipad"] : nil) ?: info[@"UISupportedInterfaceOrientations"];
  UIInterfaceOrientationMask mask = 0;
  for (NSString* name in names) {
    if ([name isEqualToString:@"UIInterfaceOrientationPortrait"]) mask |= UIInterfaceOrientationMaskPortrait;
    if ([name isEqualToString:@"UIInterfaceOrientationPortraitUpsideDown"]) mask |= UIInterfaceOrientationMaskPortraitUpsideDown;
    if ([name isEqualToString:@"UIInterfaceOrientationLandscapeLeft"]) mask |= UIInterfaceOrientationMaskLandscapeLeft;
    if ([name isEqualToString:@"UIInterfaceOrientationLandscapeRight"]) mask |= UIInterfaceOrientationMaskLandscapeRight;
  }
  if (mask) return mask;
  return pad ? UIInterfaceOrientationMaskAll : UIInterfaceOrientationMaskAllButUpsideDown;
}

bool reportURL(NSURL* url, NSString* sourceApplication) {
  if (!url) return false;
  return anyHandled(AppDelegateEvents::shared().openURL.report(
      OpenURLRequest{stringOf(url.absoluteString), stringOf(sourceApplication)}));
}

bool reportActivity(NSUserActivity* activity) {
  if (!activity) return false;
  return anyHandled(AppDelegateEvents::shared().userActivity.report(
      DelegateItem{stringOf(activity.activityType), stringOf(activity.webpageURL.absoluteString), jsonOf(activity.userInfo)}));
}

/// A reason the app was launched for, with its details as JSON. A
/// notification is reported once, whichever delegate gives it first.
void reportRelaunch(const char* reason, id details) {
  static bool notified = false;
  const bool notification = std::strcmp(reason, "notification") == 0;
  if (notification && notified) return;
  if (notification) notified = true;

  NSDictionary* info = [details isKindOfClass:[NSDictionary class]] ? details : nil;
  AppDelegateEvents::shared().relaunched.report(DelegateItem{String::fromLatin1(reason), String(), jsonOf(info)});
}

bool reportShortcut(UIApplicationShortcutItem* item) {
  if (!item) return false;
  return anyHandled(AppDelegateEvents::shared().shortcutItem.report(
      DelegateItem{stringOf(item.type), stringOf(item.localizedTitle), jsonOf(item.userInfo)}));
}

/// A UNNotification as JSON: its request's identifier and content, its
/// date, and whether a push or the app scheduled it.
String notificationJSON(id notification) {
  id request = [notification valueForKey:@"request"];
  id content = [request valueForKey:@"content"];
  id trigger = [request valueForKey:@"trigger"];
  Class push = NSClassFromString(@"UNPushNotificationTrigger");
  NSDate* date = [notification valueForKey:@"date"];
  NSMutableDictionary* out = [NSMutableDictionary dictionary];
  out[@"identifier"] = [request valueForKey:@"identifier"] ?: @"";
  for (NSString* key in @[ @"title", @"subtitle", @"body", @"categoryIdentifier", @"threadIdentifier" ])
    out[key] = [content valueForKey:key] ?: @"";
  out[@"badge"] = [content valueForKey:@"badge"] ?: [NSNull null];
  out[@"userInfo"] = [content valueForKey:@"userInfo"] ?: @{};
  out[@"date"] = date ? @(date.timeIntervalSince1970 * 1000) : [NSNull null];
  out[@"remote"] = @(push && [trigger isKindOfClass:push]);
  return jsonOf(out);
}

/// Runs `work` on the main thread, where reports are made: now if this is it.
void onMain(dispatch_block_t work) {
  if (NSThread.isMainThread)
    work();
  else
    dispatch_async(dispatch_get_main_queue(), work);
}

SEL willPresentSelector() { return NSSelectorFromString(@"userNotificationCenter:willPresentNotification:withCompletionHandler:"); }
SEL didReceiveSelector() {
  return NSSelectorFromString(@"userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:");
}

void installNotificationDelegate() {
  static dispatch_once_t once;
  dispatch_once(&once, ^{
    onMain(^{
      Class centers = NSClassFromString(@"UNUserNotificationCenter");
      if (!centers) return;
      id center = ((id (*)(id, SEL))objc_msgSend)(centers, NSSelectorFromString(@"currentNotificationCenter"));
      // The center holds its delegate weakly: this one lives as long as the process.
      static LucentNotificationDelegate* shared;
      shared = [[LucentNotificationDelegate alloc] init];
      shared.next = ((id (*)(id, SEL))objc_msgSend)(center, NSSelectorFromString(@"delegate"));
      ((void (*)(id, SEL, id))objc_msgSend)(center, NSSelectorFromString(@"setDelegate:"), shared);
    });
  });
}

}  // namespace

String jsonOf(NSDictionary* info) {
  if (!info) return String::fromLatin1("{}");
  NSData* data = [NSJSONSerialization dataWithJSONObject:jsonable(info) options:0 error:nil];
  NSString* text = data ? [[NSString alloc] initWithData:data encoding:NSUTF8StringEncoding] : nil;
  return text ? stringOf(text) : String::fromLatin1("{}");
}

Fn<void()> onOpenURL(Fn<bool(String, String)> listener, Opt<AbortSignal> signal) {
  return subscribeTo(AppDelegateEvents::shared().openURL, signal, [listener](Actor& actor, const OpenURLRequest& r) {
    return callNow(actor, [&] { return listener(r.url, r.sourceApplication); });
  });
}

Fn<void()> onUserActivity(Fn<bool(String, String, String)> listener, Opt<AbortSignal> signal) {
  return subscribeTo(AppDelegateEvents::shared().userActivity, signal, [listener](Actor& actor, const DelegateItem& a) {
    return callNow(actor, [&] { return listener(a.type, a.text, a.payload); });
  });
}

Fn<void()> onShortcutItem(Fn<bool(String, String, String)> listener, Opt<AbortSignal> signal) {
  return subscribeTo(AppDelegateEvents::shared().shortcutItem, signal, [listener](Actor& actor, const DelegateItem& s) {
    return callNow(actor, [&] { return listener(s.type, s.text, s.payload); });
  });
}

Fn<void()> onPushToken(Fn<void(Bytes)> listener, Opt<AbortSignal> signal) {
  return subscribeTo(AppDelegateEvents::shared().pushToken, signal, [listener](Actor& actor, const Bytes& token) {
    enterFromMain(actor, [listener, token] { listener(token); });
  });
}

Fn<void()> onPushTokenFailed(Fn<void(Error)> listener, Opt<AbortSignal> signal) {
  return subscribeTo(AppDelegateEvents::shared().pushTokenFailed, signal, [listener](Actor& actor, const Error& error) {
    enterFromMain(actor, [listener, error] { listener(error); });
  });
}

Fn<void()> onRemoteNotification(Fn<Promise<String>(String)> listener, Opt<AbortSignal> signal) {
  return subscribeTo(AppDelegateEvents::shared().remoteNotification, signal, [listener](Actor& actor, const RemoteNotification& n) {
    // Owed from now, so the merge waits for it, wherever the actor delays it to.
    auto reply = n.answers->reply();
    enterFromMain(actor, [listener, payload = n.payload, reply] {
      try {
        answerWith(reply, listener(payload));
      } catch (...) {
        reply(FetchResult::Failed);
        throw;
      }
    });
  });
}

Fn<void()> onBackgroundFetch(Fn<Promise<String>()> listener, Opt<AbortSignal> signal) {
  return subscribeTo(AppDelegateEvents::shared().backgroundFetch, signal,
                     [listener](Actor& actor, const std::shared_ptr<FetchAnswers>& answers) {
                       auto reply = answers->reply();
                       enterFromMain(actor, [listener, reply] {
                         try {
                           answerWith(reply, listener());
                         } catch (...) {
                           reply(FetchResult::Failed);
                           throw;
                         }
                       });
                     });
}

Fn<void()> onBackgroundURLSession(Fn<bool(String, Fn<void()>)> listener, Opt<AbortSignal> signal) {
  return subscribeTo(AppDelegateEvents::shared().backgroundURLSession, signal, [listener](Actor& actor, const URLSessionEvents& e) {
    auto reply = e.done->reply();
    Fn<void()> done([reply] { reply(FetchResult::NoData); });
    if (callNow(actor, [&] { return listener(e.identifier, done); }))
      e.claims->fetch_add(1);
    else
      reply(FetchResult::NoData);  // Not its session: nothing owed.
  });
}

Fn<void()> onSupportedInterfaceOrientations(Fn<double()> listener, Opt<AbortSignal> signal) {
  return subscribeTo(AppDelegateEvents::shared().supportedInterfaceOrientations, signal,
                     [listener](Actor& actor, const bool&) { return callNow(actor, [&] { return listener(); }); });
}

Fn<void()> onRelaunched(Fn<void(String, String)> listener, Opt<AbortSignal> signal) {
  return subscribeTo(AppDelegateEvents::shared().relaunched, signal, [listener](Actor& actor, const DelegateItem& r) {
    enterFromMain(actor, [listener, reason = r.type, details = r.payload] { listener(reason, details); });
  });
}

NSUInteger presentationOptionsNamed(const Array<String>& names) {
  // UNNotificationPresentationOptions' values: the runtime doesn't link UserNotifications.
  NSUInteger options = 0;
  for (size_t i = 0; i < names.size(); i++) {
    const String name = names.at(i);
    if (name == String::fromLatin1("badge")) options |= 1 << 0;
    if (name == String::fromLatin1("sound")) options |= 1 << 1;
    if (name == String::fromLatin1("list")) options |= 1 << 3;
    if (name == String::fromLatin1("banner")) options |= 1 << 4;
  }
  return options;
}

Fn<void()> onWillPresentNotification(Fn<Array<String>(String)> listener, Opt<AbortSignal> signal) {
  installNotificationDelegate();
  return subscribeTo(AppDelegateEvents::shared().willPresentNotification, signal,
                     [listener](Actor& actor, const String& notification) {
                       return callNow(actor, [&] { return listener(notification); });
                     });
}

Fn<void()> onNotificationResponse(Fn<void(String, String, String)> listener, Opt<AbortSignal> signal) {
  installNotificationDelegate();
  return subscribeTo(AppDelegateEvents::shared().notificationResponse, signal, [listener](Actor& actor, const NotificationResponse& r) {
    enterFromMain(actor, [listener, r] { listener(r.action, r.notification, r.text); });
  });
}

}  // namespace lucent::objc

using namespace lucent;
using namespace lucent::objc;

@implementation LucentNotificationDelegate

- (BOOL)respondsToSelector:(SEL)selector {
  return [super respondsToSelector:selector] || [self.next respondsToSelector:selector];
}

/// What only the app's delegate answers (openSettingsForNotification): its own.
- (id)forwardingTargetForSelector:(SEL)selector {
  return [self.next respondsToSelector:selector] ? self.next : [super forwardingTargetForSelector:selector];
}

- (void)userNotificationCenter:(id)center
       willPresentNotification:(id)notification
         withCompletionHandler:(void (^)(NSUInteger))completionHandler {
  onMain(^{
    NSUInteger asked = 0;
    for (const Array<String>& answer : AppDelegateEvents::shared().willPresentNotification.report(notificationJSON(notification)))
      asked |= presentationOptionsNamed(answer);

    id next = self.next;
    if ([next respondsToSelector:willPresentSelector()]) {
      ((void (*)(id, SEL, id, id, void (^)(NSUInteger)))objc_msgSend)(next, willPresentSelector(), center, notification,
                                                                      ^(NSUInteger options) {
                                                                        completionHandler(options | asked);
                                                                      });
    } else {
      completionHandler(asked);
    }
  });
}

- (void)userNotificationCenter:(id)center
    didReceiveNotificationResponse:(id)response
             withCompletionHandler:(void (^)(void))completionHandler {
  onMain(^{
    // A text input action's response has the text typed.
    SEL typed = NSSelectorFromString(@"userText");
    NSString* text = [response respondsToSelector:typed] ? [response valueForKey:@"userText"] : nil;
    AppDelegateEvents::shared().notificationResponse.report(NotificationResponse{
        stringOf([response valueForKey:@"actionIdentifier"]), notificationJSON([response valueForKey:@"notification"]), stringOf(text)});

    id next = self.next;
    if ([next respondsToSelector:didReceiveSelector()])
      ((void (*)(id, SEL, id, id, void (^)(void)))objc_msgSend)(next, didReceiveSelector(), center, response, completionHandler);
    else
      completionHandler();
  });
}

@end

@implementation LucentAppDelegate

+ (void)application:(UIApplication*)application
    didFinishLaunchingWithOptions:(NSDictionary<UIApplicationLaunchOptionsKey, id>*)launchOptions {
  // Launch modules first: they register with the OS before launch ends, and hear what follows.
  lucent_launch();

  reportURL(launchOptions[UIApplicationLaunchOptionsURLKey], launchOptions[UIApplicationLaunchOptionsSourceApplicationKey]);
  reportShortcut(launchOptions[UIApplicationLaunchOptionsShortcutItemKey]);
  NSDictionary* activity = launchOptions[UIApplicationLaunchOptionsUserActivityDictionaryKey];
  for (id value in activity.allValues)
    if ([value isKindOfClass:[NSUserActivity class]]) reportActivity(value);

  // Relaunched in the background for a location event or a Bluetooth accessory, or opened from a
  // notification: the restoration identifiers of the Bluetooth managers to make again.
  if (launchOptions[UIApplicationLaunchOptionsLocationKey]) reportRelaunch("location", @{});
  if (NSArray* centrals = launchOptions[UIApplicationLaunchOptionsBluetoothCentralsKey])
    reportRelaunch("bluetoothCentrals", @{@"restorationIdentifiers" : centrals});
  if (NSArray* peripherals = launchOptions[UIApplicationLaunchOptionsBluetoothPeripheralsKey])
    reportRelaunch("bluetoothPeripherals", @{@"restorationIdentifiers" : peripherals});
  if (NSDictionary* notification = launchOptions[UIApplicationLaunchOptionsRemoteNotificationKey])
    reportRelaunch("notification", notification);
}

+ (BOOL)application:(UIApplication*)application openURL:(NSURL*)url options:(NSDictionary<UIApplicationOpenURLOptionsKey, id>*)options {
  return reportURL(url, options[UIApplicationOpenURLOptionsSourceApplicationKey]);
}

+ (BOOL)application:(UIApplication*)application continueUserActivity:(NSUserActivity*)userActivity {
  return reportActivity(userActivity);
}

+ (void)application:(UIApplication*)application didRegisterForRemoteNotificationsWithDeviceToken:(NSData*)deviceToken {
  AppDelegateEvents::shared().pushToken.report(Bytes::copy(static_cast<const uint8_t*>(deviceToken.bytes), deviceToken.length));
}

+ (void)application:(UIApplication*)application didFailToRegisterForRemoteNotificationsWithError:(NSError*)error {
  AppDelegateEvents::shared().pushTokenFailed.report(fromNSError(error, "didFailToRegisterForRemoteNotifications"));
}

+ (BOOL)application:(UIApplication*)application
    didReceiveRemoteNotification:(NSDictionary*)userInfo
          fetchCompletionHandler:(void (^)(UIBackgroundFetchResult))completionHandler {
  auto& event = AppDelegateEvents::shared().remoteNotification;
  if (event.subscriptions() == 0) return NO;
  auto answers = fetchAnswers(completionHandler);
  event.report(RemoteNotification{jsonOf(userInfo), answers});
  answers->close();
  return YES;
}

+ (BOOL)application:(UIApplication*)application performFetchWithCompletionHandler:(void (^)(UIBackgroundFetchResult))completionHandler {
  auto& event = AppDelegateEvents::shared().backgroundFetch;
  if (event.subscriptions() == 0) return NO;
  auto answers = fetchAnswers(completionHandler);
  event.report(answers);
  answers->close();
  return YES;
}

+ (BOOL)application:(UIApplication*)application
    handleEventsForBackgroundURLSession:(NSString*)identifier
                      completionHandler:(void (^)(void))completionHandler {
  auto& event = AppDelegateEvents::shared().backgroundURLSession;
  if (event.subscriptions() == 0) return NO;
  auto claims = std::make_shared<std::atomic<int>>(0);
  // Once every module that claimed it is done; none claiming leaves it to the caller.
  auto done = FetchAnswers::start([completionHandler, claims](FetchResult) {
    if (claims->load() == 0) return;
    dispatch_async(dispatch_get_main_queue(), ^{
      completionHandler();
    });
  });
  event.report(URLSessionEvents{stringOf(identifier), done, claims});
  const bool claimed = claims->load() > 0;
  done->close();
  return claimed ? YES : NO;
}

+ (BOOL)application:(UIApplication*)application
    performActionForShortcutItem:(UIApplicationShortcutItem*)shortcutItem
               completionHandler:(void (^)(BOOL))completionHandler {
  if (!reportShortcut(shortcutItem)) return NO;
  completionHandler(YES);
  return YES;
}

+ (UIInterfaceOrientationMask)application:(UIApplication*)application
    supportedInterfaceOrientationsForWindow:(UIWindow*)window
                                defaultMask:(UIInterfaceOrientationMask)given {
  const UIInterfaceOrientationMask mask = given ? given : infoPlistOrientations();
  UIInterfaceOrientationMask allowed = mask;
  for (double answer : AppDelegateEvents::shared().supportedInterfaceOrientations.report(true)) {
    auto said = static_cast<UIInterfaceOrientationMask>(answer > 0 ? answer : 0);
    if (said) allowed &= said;
  }
  return allowed ? allowed : mask;
}

+ (void)scene:(UIScene*)scene willConnectWithOptions:(UISceneConnectionOptions*)connectionOptions {
  for (UIOpenURLContext* context in connectionOptions.URLContexts) reportURL(context.URL, context.options.sourceApplication);
  for (NSUserActivity* activity in connectionOptions.userActivities) reportActivity(activity);
  reportShortcut(connectionOptions.shortcutItem);
  // A UNNotificationResponse, read by key so that the runtime needs no UserNotifications.
  if (id opened = connectionOptions.notificationResponse)
    reportRelaunch("notification", [opened valueForKeyPath:@"notification.request.content.userInfo"]);
}

+ (BOOL)scene:(UIScene*)scene openURLContexts:(NSSet<UIOpenURLContext*>*)URLContexts {
  BOOL opened = NO;
  for (UIOpenURLContext* context in URLContexts) opened = reportURL(context.URL, context.options.sourceApplication) || opened;
  return opened;
}

+ (BOOL)scene:(UIScene*)scene continueUserActivity:(NSUserActivity*)userActivity {
  return reportActivity(userActivity);
}

+ (BOOL)windowScene:(UIWindowScene*)windowScene
    performActionForShortcutItem:(UIApplicationShortcutItem*)shortcutItem
               completionHandler:(void (^)(BOOL))completionHandler {
  if (!reportShortcut(shortcutItem)) return NO;
  completionHandler(YES);
  return YES;
}

@end

/// In an Expo app, what Expo's AppDelegate forwards to its subscribers
/// (ExpoAppDelegateSubscriberManager), forwarded to LucentAppDelegate, so
/// the app needs no line of its own. Registered at load, before any
/// delegate method, as Expo registers its own; in an app without Expo it is
/// never made. Each completion handler it's given, it calls once, as Expo's
/// merge of its subscribers' answers waits for.
@interface LucentExpoSubscriber : UIResponder <UIApplicationDelegate>
@end

@implementation LucentExpoSubscriber

+ (void)load {
  Class repository = NSClassFromString(@"EXExpoAppDelegateSubscriberRepository");
  SEL registering = NSSelectorFromString(@"registerSubscriber:");
  if (!repository || ![repository respondsToSelector:registering]) return;
  // What Expo's subscribers conform to, though nothing of it is needed beyond UIApplicationDelegate.
  if (Protocol* subscriber = objc_getProtocol("EXAppDelegateSubscriberProtocol"))
    class_addProtocol(self, subscriber);
  ((void (*)(id, SEL, id))objc_msgSend)(repository, registering, [[LucentExpoSubscriber alloc] init]);
}

/// Orientations only while a module has a say: otherwise Expo keeps Info.plist's.
- (BOOL)respondsToSelector:(SEL)selector {
  if (selector == @selector(application:supportedInterfaceOrientationsForWindow:))
    return AppDelegateEvents::shared().supportedInterfaceOrientations.subscriptions() > 0;
  return [super respondsToSelector:selector];
}

- (BOOL)application:(UIApplication*)application didFinishLaunchingWithOptions:(NSDictionary<UIApplicationLaunchOptionsKey, id>*)launchOptions {
  [LucentAppDelegate application:application didFinishLaunchingWithOptions:launchOptions];
  return YES;
}

- (BOOL)application:(UIApplication*)app openURL:(NSURL*)url options:(NSDictionary<UIApplicationOpenURLOptionsKey, id>*)options {
  return [LucentAppDelegate application:app openURL:url options:options];
}

- (BOOL)application:(UIApplication*)application
    continueUserActivity:(NSUserActivity*)userActivity
      restorationHandler:(void (^)(NSArray<id<UIUserActivityRestoring>>*))restorationHandler {
  BOOL continued = [LucentAppDelegate application:application continueUserActivity:userActivity];
  restorationHandler(nil);
  return continued;
}

- (void)application:(UIApplication*)application didRegisterForRemoteNotificationsWithDeviceToken:(NSData*)deviceToken {
  [LucentAppDelegate application:application didRegisterForRemoteNotificationsWithDeviceToken:deviceToken];
}

- (void)application:(UIApplication*)application didFailToRegisterForRemoteNotificationsWithError:(NSError*)error {
  [LucentAppDelegate application:application didFailToRegisterForRemoteNotificationsWithError:error];
}

- (void)application:(UIApplication*)application
    didReceiveRemoteNotification:(NSDictionary*)userInfo
          fetchCompletionHandler:(void (^)(UIBackgroundFetchResult))completionHandler {
  if (![LucentAppDelegate application:application didReceiveRemoteNotification:userInfo fetchCompletionHandler:completionHandler])
    completionHandler(UIBackgroundFetchResultNoData);
}

- (void)application:(UIApplication*)application
    handleEventsForBackgroundURLSession:(NSString*)identifier
                      completionHandler:(void (^)(void))completionHandler {
  if (![LucentAppDelegate application:application handleEventsForBackgroundURLSession:identifier completionHandler:completionHandler])
    completionHandler();
}

- (void)application:(UIApplication*)application
    performActionForShortcutItem:(UIApplicationShortcutItem*)shortcutItem
               completionHandler:(void (^)(BOOL))completionHandler {
  if (![LucentAppDelegate application:application performActionForShortcutItem:shortcutItem completionHandler:completionHandler])
    completionHandler(NO);
}

- (UIInterfaceOrientationMask)application:(UIApplication*)application supportedInterfaceOrientationsForWindow:(UIWindow*)window {
  return [LucentAppDelegate application:application supportedInterfaceOrientationsForWindow:window defaultMask:0];
}

@end
