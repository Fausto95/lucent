import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import {
  APP_DELEGATE,
  APP_FORWARDS,
  FORWARD,
  IMPORT,
  missingForwards,
  SCENE_DELEGATE,
  SCENE_FORWARDS,
  withForwards,
  withoutForwards,
} from "../src/cli/init/app-delegate.ts";
import { planInit } from "../src/cli/init/plan.ts";
import { planUninstall } from "../src/cli/init/uninstall.ts";

/*
 * The calls lucent init adds to a bare app's delegates, which forward what
 * only they receive to Lucent modules (LucentAppDelegate, T110): a line
 * first in each method the app has, the methods it lacks, and the import;
 * once, and taken out again by lucent uninstall.
 */

/** The React Native template's AppDelegate, as `lucent create` and the CLI's init make it. */
const template = `import UIKit
import React
import React_RCTAppDelegate
import ReactAppDependencyProvider

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  var window: UIWindow?

  func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    window = UIWindow(frame: UIScreen.main.bounds)
    return true
  }
}

class ReactNativeDelegate: RCTDefaultReactNativeFactoryDelegate {
  override func bundleURL() -> URL? { nil }
}
`;

/** An app delegate that already opens URLs, with its own names, and answers in one expression. */
const opening = `import UIKit

@main
class AppDelegate: UIResponder, UIApplicationDelegate {
  func application(_ app: UIApplication, didFinishLaunchingWithOptions options: [UIApplication.LaunchOptionsKey: Any]?) -> Bool {
    true
  }

  func application(_ app: UIApplication, open link: URL, options opts: [UIApplication.OpenURLOptionsKey: Any] = [:]) -> Bool {
    // "{" in a comment and a string: "}"
    return RCTLinkingManager.application(app, open: link, options: opts)
  }
}
`;

const scene = `import UIKit

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
  func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
    guard let _ = (scene as? UIWindowScene) else { return }
  }
}
`;

describe("the app delegate's forwarding", () => {
  it("puts a line first in the methods the app has, and adds the rest, once", () => {
    const out = withForwards(template, APP_DELEGATE, APP_FORWARDS)!;

    expect(out).toContain(`import ReactAppDependencyProvider\n${IMPORT}\n`);
    expect(out).toContain(
      `  ) -> Bool {\n    LucentAppDelegate.application(application, didFinishLaunchingWithOptions: launchOptions) ${FORWARD}\n    window =`,
    );
    for (const call of [
      "LucentAppDelegate.application(app, open: url, options: options)",
      "LucentAppDelegate.application(application, continue: userActivity)",
      "didRegisterForRemoteNotificationsWithDeviceToken: deviceToken",
      "didFailToRegisterForRemoteNotificationsWithError: error",
      "handleEventsForBackgroundURLSession: identifier, completionHandler: completionHandler) { completionHandler() }",
      "performActionFor: shortcutItem, completionHandler: completionHandler) { completionHandler(false) }",
    ])
      expect(out).toContain(call);
    // In the app delegate's class, not the next one.
    expect(out.indexOf("lucent:forward end")).toBeLessThan(
      out.indexOf("class ReactNativeDelegate"),
    );
    // Neither the remote notification's nor the orientations' method: added unasked, they change the app.
    expect(out).not.toContain("didReceiveRemoteNotification");
    expect(out).not.toContain("supportedInterfaceOrientationsFor");

    expect(withForwards(out, APP_DELEGATE, APP_FORWARDS)).toBe(out);
    expect(missingForwards(template, APP_FORWARDS)).toHaveLength(APP_FORWARDS.length);
    expect(missingForwards(out, APP_FORWARDS)).toEqual([]);
    expect(withoutForwards(out)).toBe(template);
  });

  it("names the parameters as the app does, and returns an expression a line now precedes", () => {
    const out = withForwards(opening, APP_DELEGATE, APP_FORWARDS)!;

    expect(out).toContain(
      `-> Bool {\n    LucentAppDelegate.application(app, didFinishLaunchingWithOptions: options) ${FORWARD}\n    return true\n  }`,
    );
    expect(out).toContain(
      `    _ = LucentAppDelegate.application(app, open: link, options: opts) ${FORWARD}\n    // "{" in a comment`,
    );
    // The app's own method: not added again.
    expect(out.match(/open \w+: URL/g)).toHaveLength(1);
  });

  it("forwards a scene delegate's launch options, URLs, activities and shortcuts", () => {
    const out = withForwards(scene, SCENE_DELEGATE, SCENE_FORWARDS)!;

    expect(out).toContain(
      `UIScene.ConnectionOptions) {\n    LucentAppDelegate.scene(scene, willConnectWithOptions: connectionOptions) ${FORWARD}\n    guard`,
    );
    expect(out).toContain("_ = LucentAppDelegate.scene(scene, openURLContexts: URLContexts)");
    expect(out).toContain("_ = LucentAppDelegate.scene(scene, continue: userActivity)");
    expect(out).toContain(
      "LucentAppDelegate.windowScene(windowScene, performActionFor: shortcutItem",
    );
    expect(withoutForwards(out)).toBe(scene);
    expect(
      withForwards("struct NotADelegate {}\n", SCENE_DELEGATE, SCENE_FORWARDS),
    ).toBeUndefined();
  });
});

function bareApp(files: Record<string, string>): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-forward-"));
  const all = {
    "package.json": JSON.stringify({ name: "Bare", dependencies: { "react-native": "0.88.0" } }),
    "react-native.config.js": "module.exports = {};\n",
    ...files,
  };
  for (const [name, text] of Object.entries(all)) {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  }
  return root;
}

describe("lucent init and uninstall, with the app's delegates", () => {
  it("forward from the app and scene delegates, and stop", () => {
    const root = bareApp({
      "ios/Bare/AppDelegate.swift": template,
      "ios/Bare/SceneDelegate.swift": scene,
      "ios/Pods/Fake/AppDelegate.swift": "not the app's",
    });
    const plan = planInit(root);
    const changed = (file: string) => plan.changes.find((c) => c.file === file)?.after;

    expect(changed("ios/Bare/AppDelegate.swift")).toBe(
      withForwards(template, APP_DELEGATE, APP_FORWARDS),
    );
    expect(changed("ios/Bare/SceneDelegate.swift")).toBe(
      withForwards(scene, SCENE_DELEGATE, SCENE_FORWARDS),
    );

    for (const c of plan.changes) {
      fs.mkdirSync(path.dirname(path.join(root, c.file)), { recursive: true });
      fs.writeFileSync(path.join(root, c.file), c.after);
    }
    expect(planInit(root).changes.map((c) => c.file)).not.toContain("ios/Bare/AppDelegate.swift");

    const undo = planUninstall(root);
    const reverted = (file: string) => undo.changes.find((c) => c.file === file)?.after;
    expect(reverted("ios/Bare/AppDelegate.swift")).toBe(template);
    expect(reverted("ios/Bare/SceneDelegate.swift")).toBe(scene);
  });

  it("asks an Objective-C app delegate for the calls", () => {
    const root = bareApp({ "ios/Bare/AppDelegate.mm": "@implementation AppDelegate\n@end\n" });
    const plan = planInit(root);

    expect(plan.manual.map((m) => m.file)).toContain("ios/Bare/AppDelegate.mm");
    expect(plan.manual.find((m) => m.file === "ios/Bare/AppDelegate.mm")!.snippet).toContain(
      "[LucentAppDelegate application:app openURL:url options:options];",
    );
  });
});
