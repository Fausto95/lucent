import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import LucentNative // lucent:forward

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  var reactNativeDelegate: ReactNativeDelegate?
  var reactNativeFactory: RCTReactNativeFactory?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    LucentAppDelegate.application(application, didFinishLaunchingWithOptions: launchOptions) // lucent:forward
    let delegate = ReactNativeDelegate()
    let factory = RCTReactNativeFactory(delegate: delegate)
    delegate.dependencyProvider = RCTAppDependencyProvider()

    reactNativeDelegate = delegate
    reactNativeFactory = factory

    window = UIWindow(frame: UIScreen.main.bounds)

    factory.startReactNative(
      withModuleName: "HelloWorld",
      in: window,
      launchOptions: launchOptions
    )

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

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func sourceURL(for bridge: RCTBridge) -> URL? {
    self.bundleURL()
  }

  override func bundleURL() -> URL? {
#if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
#else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
#endif
  }
}
