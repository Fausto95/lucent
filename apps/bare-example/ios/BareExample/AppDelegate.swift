import UIKit
import LucentNative // lucent:forward

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  /// An instance of a Lucent class the app's own Swift made (src/sdk/callers.lucent.ts): it
  /// holds the module's state, which the Platform screen's JavaScript reads.
  private var tally: Callers.Tally?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    LucentAppDelegate.application(application, didFinishLaunchingWithOptions: launchOptions) // lucent:forward
    // Swift calling a Lucent module, through the API Lucent generates in LucentNative.
    tally = try? Callers.Tally(from: "swift")
    _ = try? tally?.add(n: 2)
    try? Callers.note(text: "swift at launch")
    return true
  }
  // lucent:forward begin
  func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    LucentAppDelegate.application(app, open: url, options: options) // lucent:forward
  }
  // lucent:forward end
  // lucent:forward begin
  func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    LucentAppDelegate.application(application, continue: userActivity) // lucent:forward
  }
  // lucent:forward end
  // lucent:forward begin
  func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    LucentAppDelegate.application(application, didRegisterForRemoteNotificationsWithDeviceToken: deviceToken) // lucent:forward
  }
  // lucent:forward end
  // lucent:forward begin
  func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    LucentAppDelegate.application(application, didFailToRegisterForRemoteNotificationsWithError: error) // lucent:forward
  }
  // lucent:forward end
  // lucent:forward begin
  func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable: Any],
    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    if !LucentAppDelegate.application(application, didReceiveRemoteNotification: userInfo, fetchCompletionHandler: completionHandler) { completionHandler(.noData) } // lucent:forward
  }
  // lucent:forward end
  // lucent:forward begin
  func application(
    _ application: UIApplication,
    performFetchWithCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    if !LucentAppDelegate.application(application, performFetchWithCompletionHandler: completionHandler) { completionHandler(.noData) } // lucent:forward
  }
  // lucent:forward end
  // lucent:forward begin
  func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    if !LucentAppDelegate.application(application, handleEventsForBackgroundURLSession: identifier, completionHandler: completionHandler) { completionHandler() } // lucent:forward
  }
  // lucent:forward end
  // lucent:forward begin
  func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    if !LucentAppDelegate.application(application, performActionFor: shortcutItem, completionHandler: completionHandler) { completionHandler(false) } // lucent:forward
  }
  // lucent:forward end
}
