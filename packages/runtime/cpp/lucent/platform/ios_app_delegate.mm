// Lucent runtime — LucentAppDelegate (what the delegates forward) and
// module code's subscriptions to it (ios_app_delegate.h). Objective-C++
// with ARC, iOS only.
#import "LucentAppDelegate.h"

#include "ios_app_delegate.h"

#include <algorithm>
#include <memory>
#include <vector>

#include "../native.h"
#include "ios_ui.h"

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

bool reportShortcut(UIApplicationShortcutItem* item) {
  if (!item) return false;
  return anyHandled(AppDelegateEvents::shared().shortcutItem.report(
      DelegateItem{stringOf(item.type), stringOf(item.localizedTitle), jsonOf(item.userInfo)}));
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

}  // namespace lucent::objc

using namespace lucent;
using namespace lucent::objc;

@implementation LucentAppDelegate

+ (void)application:(UIApplication*)application
    didFinishLaunchingWithOptions:(NSDictionary<UIApplicationLaunchOptionsKey, id>*)launchOptions {
  reportURL(launchOptions[UIApplicationLaunchOptionsURLKey], launchOptions[UIApplicationLaunchOptionsSourceApplicationKey]);
  reportShortcut(launchOptions[UIApplicationLaunchOptionsShortcutItemKey]);
  NSDictionary* activity = launchOptions[UIApplicationLaunchOptionsUserActivityDictionaryKey];
  for (id value in activity.allValues)
    if ([value isKindOfClass:[NSUserActivity class]]) reportActivity(value);
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
