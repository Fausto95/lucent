// Lucent runtime — module code's side of what the app delegate and the
// scene delegate forward (LucentAppDelegate.h): `onAppEvent` from
// lucent:ios for "openURL", "pushToken" and the rest (Objective-C++ with
// ARC, iOS only). Each subscription lasts until its returned function is
// called, its signal aborts, or the JavaScript runtime it was made for
// goes.
#pragma once

#import <UIKit/UIKit.h>

#include <atomic>
#include <memory>

#include "../abort.h"
#include "../async.h"
#include "../bytes.h"
#include "../delegate_events.h"
#include "../function.h"
#include "ios.h"

namespace lucent::objc {

/// A URL the app is asked to open, and the bundle id of the app that asked
/// ("" when UIKit doesn't say).
struct OpenURLRequest {
  String url;
  String sourceApplication;
};

/// A user activity, a home screen shortcut or a notification: its type, a
/// URL or title ("" for none), and its userInfo as JSON.
struct DelegateItem {
  String type;
  String text;
  String payload;
};

/// A remote notification's userInfo as JSON, and where each module answers.
struct RemoteNotification {
  String payload;
  std::shared_ptr<FetchAnswers> answers;
};

/// A background URL session's identifier, where the modules that claim it
/// say they're done, and how many did.
struct URLSessionEvents {
  String identifier;
  std::shared_ptr<FetchAnswers> done;
  std::shared_ptr<std::atomic<int>> claims;
};

/// What the delegates report, and Lucent code subscribes to.
struct AppDelegateEvents {
  DelegateEvent<OpenURLRequest, bool> openURL{true};
  DelegateEvent<DelegateItem, bool> userActivity{true};
  DelegateEvent<DelegateItem, bool> shortcutItem{true};
  DelegateEvent<Bytes> pushToken{true};
  DelegateEvent<Error> pushTokenFailed;
  DelegateEvent<RemoteNotification> remoteNotification;
  DelegateEvent<std::shared_ptr<FetchAnswers>> backgroundFetch;
  DelegateEvent<URLSessionEvents> backgroundURLSession;
  DelegateEvent<bool, double> supportedInterfaceOrientations;
  /// Why iOS launched the app in the background, or a notification the
  /// person opened it with: the reason ("location", "bluetoothCentrals",
  /// "bluetoothPeripherals", "notification") and its details as JSON.
  DelegateEvent<DelegateItem> relaunched{true};

  /// The process's, which LucentAppDelegate reports to.
  static AppDelegateEvents& shared();
};

/// UIBackgroundFetchResult's name in lucent:ios ("newData", "noData",
/// "failed"); anything else is no data.
FetchResult fetchResultNamed(const String& name);

// `onAppEvent(event, listener, signal)` from lucent:ios, by event. Each
// listener runs on the main thread holding the subscriber's actor. One
// that answers (a URL, an activity, a shortcut, a session, orientations)
// runs while UIKit waits, as callNow does; the others run once the main
// thread can take the actor (enterFromMain).

/// "openURL": `listener(url, sourceApplication)`, true if it opened it.
Fn<void()> onOpenURL(Fn<bool(String, String)> listener, Opt<AbortSignal> signal = {});
/// "userActivity": `listener(type, webpageURL, userInfo)`, true if it continued it.
Fn<void()> onUserActivity(Fn<bool(String, String, String)> listener, Opt<AbortSignal> signal = {});
/// "shortcutItem": `listener(type, title, userInfo)`, true if it handled it.
Fn<void()> onShortcutItem(Fn<bool(String, String, String)> listener, Opt<AbortSignal> signal = {});
/// "pushToken": `listener(token)`, the device token's bytes.
Fn<void()> onPushToken(Fn<void(Bytes)> listener, Opt<AbortSignal> signal = {});
/// "pushTokenFailed": `listener(error)`, the registration's NSError as an Error.
Fn<void()> onPushTokenFailed(Fn<void(Error)> listener, Opt<AbortSignal> signal = {});
/// "remoteNotification": `listener(userInfo)` resolves with its fetch result.
Fn<void()> onRemoteNotification(Fn<Promise<String>(String)> listener, Opt<AbortSignal> signal = {});
/// "backgroundFetch": `listener()` resolves with its fetch result.
Fn<void()> onBackgroundFetch(Fn<Promise<String>()> listener, Opt<AbortSignal> signal = {});
/// "backgroundURLSession": `listener(identifier, done)`, true if the session
/// is its own; it calls `done` once it handled the session's events.
Fn<void()> onBackgroundURLSession(Fn<bool(String, Fn<void()>)> listener, Opt<AbortSignal> signal = {});
/// "supportedInterfaceOrientations": `listener()`, a UIInterfaceOrientationMask, or 0 for no say.
Fn<void()> onSupportedInterfaceOrientations(Fn<double()> listener, Opt<AbortSignal> signal = {});
/// "relaunched": `listener(reason, details)`, once for each reason the app was launched for.
Fn<void()> onRelaunched(Fn<void(String, String)> listener, Opt<AbortSignal> signal = {});

/// A userInfo dictionary as JSON: values JSON has no form for (a date,
/// data, any other object) as their description.
String jsonOf(NSDictionary* info);

}  // namespace lucent::objc
