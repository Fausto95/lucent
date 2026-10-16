import React
import React_RCTAppDelegate
import ReactAppDependencyProvider
import UIKit
import LucentNative // lucent:forward

class SceneDelegate: RCTDefaultReactNativeFactoryDelegate, UIWindowSceneDelegate {
  var window: UIWindow?
  var reactNativeFactory: RCTReactNativeFactory?

  func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    LucentAppDelegate.scene(scene, willConnectWithOptions: connectionOptions) // lucent:forward
    guard let windowScene = scene as? UIWindowScene else {
      return
    }

    dependencyProvider = RCTAppDependencyProvider()
    reactNativeFactory = RCTReactNativeFactory(delegate: self)
    window = UIWindow(windowScene: windowScene)
    
    #if DEBUG
    let devMenuConfiguration = RCTDevMenuConfiguration(
      devMenuEnabled: true,
      shakeGestureEnabled: true,
      keyboardShortcutsEnabled: true
    )
    reactNativeFactory?.devMenuConfiguration = devMenuConfiguration
    #endif
    
    reactNativeFactory?.startReactNative(
      withModuleName: "HelloWorld",
      in: window,
      connectionOptions: connectionOptions
    )

   
  }

  func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    _ = LucentAppDelegate.scene(scene, openURLContexts: URLContexts) // lucent:forward
    RCTLinkingManager.scene(scene, openURLContexts: URLContexts)
  }

  func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = LucentAppDelegate.scene(scene, continue: userActivity) // lucent:forward
    RCTLinkingManager.scene(scene, continue: userActivity)
  }

  override func bundleURL() -> URL? {
    #if DEBUG
    RCTBundleURLProvider.sharedSettings().jsBundleURL(forBundleRoot: "index")
    #else
    Bundle.main.url(forResource: "main", withExtension: "jsbundle")
    #endif
  }
  // lucent:forward begin
  func windowScene(
    _ windowScene: UIWindowScene,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    if !LucentAppDelegate.windowScene(windowScene, performActionFor: shortcutItem, completionHandler: completionHandler) { completionHandler(false) } // lucent:forward
  }
  // lucent:forward end
}
