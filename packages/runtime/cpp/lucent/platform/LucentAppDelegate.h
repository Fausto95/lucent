// Lucent runtime — what the app delegate, and a scene delegate, forward to
// Lucent modules (T110, decision 0076): one call in each delegate method,
// which `lucent init` writes in a bare app and Lucent's Expo subscriber
// makes in an Expo app. Plain Objective-C, so Swift imports it.
#import <UIKit/UIKit.h>

NS_ASSUME_NONNULL_BEGIN

/// Each method reports what UIKit gave the delegate to the modules that
/// subscribed with `onAppEvent` from lucent:ios, on the main thread, and
/// answers for them. A URL, a user activity or a shortcut that comes before
/// any module subscribed waits for the first one.
__attribute__((visibility("default")))
@interface LucentAppDelegate : NSObject

/// The URL, user activity or shortcut that launched an app without scenes.
+ (void)application:(UIApplication *)application
    didFinishLaunchingWithOptions:(nullable NSDictionary<UIApplicationLaunchOptionsKey, id> *)launchOptions;

/// Whether a module opened it.
+ (BOOL)application:(UIApplication *)application
            openURL:(NSURL *)url
            options:(NSDictionary<UIApplicationOpenURLOptionsKey, id> *)options;

/// Whether a module continued it.
+ (BOOL)application:(UIApplication *)application continueUserActivity:(NSUserActivity *)userActivity;

+ (void)application:(UIApplication *)application
    didRegisterForRemoteNotificationsWithDeviceToken:(NSData *)deviceToken;

+ (void)application:(UIApplication *)application
    didFailToRegisterForRemoteNotificationsWithError:(NSError *)error;

/// Whether a module takes it: Lucent then calls `completionHandler` once,
/// with the modules' answers merged, else the caller does.
+ (BOOL)application:(UIApplication *)application
    didReceiveRemoteNotification:(NSDictionary *)userInfo
          fetchCompletionHandler:(void (^)(UIBackgroundFetchResult result))completionHandler;

/// As for a remote notification.
+ (BOOL)application:(UIApplication *)application
    performFetchWithCompletionHandler:(void (^)(UIBackgroundFetchResult result))completionHandler;

/// Whether a module claims the session: Lucent then calls
/// `completionHandler` once every module that claimed it is done.
+ (BOOL)application:(UIApplication *)application
    handleEventsForBackgroundURLSession:(NSString *)identifier
                      completionHandler:(void (^)(void))completionHandler;

/// Whether a module handled it: Lucent then calls `completionHandler` with YES.
+ (BOOL)application:(UIApplication *)application
    performActionForShortcutItem:(UIApplicationShortcutItem *)shortcutItem
               completionHandler:(void (^)(BOOL succeeded))completionHandler;

/// The orientations every module that has a say allows, of `mask` (what the
/// app allows otherwise): `mask` when none has a say, or they share none.
+ (UIInterfaceOrientationMask)application:(UIApplication *)application
    supportedInterfaceOrientationsForWindow:(nullable UIWindow *)window
                                defaultMask:(UIInterfaceOrientationMask)mask;

// In an app with scenes, UIKit gives these to the scene delegate instead.

/// The URLs, user activity or shortcut that launched the app or the scene.
+ (void)scene:(UIScene *)scene willConnectWithOptions:(UISceneConnectionOptions *)connectionOptions;

/// Whether a module opened one of them.
+ (BOOL)scene:(UIScene *)scene openURLContexts:(NSSet<UIOpenURLContext *> *)URLContexts;

/// Whether a module continued it.
+ (BOOL)scene:(UIScene *)scene continueUserActivity:(NSUserActivity *)userActivity;

/// As for the app delegate's shortcut.
+ (BOOL)windowScene:(UIWindowScene *)windowScene
    performActionForShortcutItem:(UIApplicationShortcutItem *)shortcutItem
               completionHandler:(void (^)(BOOL succeeded))completionHandler;

@end

NS_ASSUME_NONNULL_END
