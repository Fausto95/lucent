import fs from "node:fs";
import path from "node:path";

/**
 * The calls `lucent init` adds to a bare app's AppDelegate.swift and
 * SceneDelegate.swift, which forward what only those delegates receive to
 * Lucent modules (`LucentAppDelegate` from the native package, T110 and
 * decision 0076). A delegate method the app has gets one line, first in
 * its body; one it lacks is added. Every line Lucent writes ends with
 * FORWARD, and an added method sits between ADDED and its end mark, so
 * `lucent doctor` finds them and `lucent uninstall` takes them out.
 *
 * Only calls that change nothing for an app whose modules don't listen are
 * added: a remote notification's method makes UIKit ask for the
 * remote-notification background mode, and an orientations method
 * replaces Info.plist's, so those two are left for the app to add
 * (`OPTIONAL_FORWARDS`), as `lucent build` says when a module listens.
 */

/** The end of each line Lucent writes. */
export const FORWARD = "// lucent:forward";
/** The first and last lines of a method Lucent added. */
export const ADDED = "// lucent:forward begin";
export const ADDED_END = "// lucent:forward end";
/** What makes `LucentAppDelegate` visible to Swift. */
export const IMPORT = `import LucentNative ${FORWARD}`;

interface Forward {
  /** The delegate method, as Swift names it, for messages. */
  method: string;
  /** Finds the method: its parameters' local names, in order. */
  find: RegExp;
  /** The line put first in the method, from its parameters' names. */
  line: (names: string[]) => string;
  /** The method, added when the delegate lacks it (its line inside). */
  add: string;
}

/** `label name: Type…` (or `label: Type…`, the name being the label): the local name is a group. */
const param = (label: string, type: string) =>
  `${label === "_" ? "_\\s+(\\w+)" : `${label}(?:\\s+(\\w+))?`}\\s*:\\s*${type}`;

/** A method's signature, up to its parameters' end: each part's local name is a group. */
function signature(name: string, parts: [label: string, type: string][]): RegExp {
  return new RegExp(
    `func\\s+${name}\\s*\\(\\s*${parts.map(([l, t]) => param(l, t)).join("[^,]*,\\s*")}`,
  );
}

/** The local names `find` matched, a part without its own being its label. */
function namesOf(match: RegExpExecArray, labels: string[]): string[] {
  return labels.map((label, i) => match[i + 1] ?? label);
}

const app = (parts: [string, string][]) =>
  signature("application", [["_", "UIApplication"], ...parts]);

/** What the app delegate forwards. */
export const APP_FORWARDS: (Forward & { labels: string[] })[] = [
  {
    method: "application(_:didFinishLaunchingWithOptions:)",
    labels: ["application", "launchOptions"],
    find: app([["didFinishLaunchingWithOptions", "\\["]]),
    line: ([a, o]) => `LucentAppDelegate.application(${a}, didFinishLaunchingWithOptions: ${o})`,
    add: `func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    LucentAppDelegate.application(application, didFinishLaunchingWithOptions: launchOptions) ${FORWARD}
    return true
  }`,
  },
  {
    method: "application(_:open:options:)",
    labels: ["app", "url", "options"],
    find: app([
      ["open", "URL"],
      ["options", "\\["],
    ]),
    line: ([a, u, o]) => `_ = LucentAppDelegate.application(${a}, open: ${u}, options: ${o})`,
    add: `func application(
    _ app: UIApplication,
    open url: URL,
    options: [UIApplication.OpenURLOptionsKey: Any] = [:]
  ) -> Bool {
    LucentAppDelegate.application(app, open: url, options: options) ${FORWARD}
  }`,
  },
  {
    method: "application(_:continue:restorationHandler:)",
    labels: ["application", "userActivity"],
    find: app([["continue", "NSUserActivity"]]),
    line: ([a, u]) => `_ = LucentAppDelegate.application(${a}, continue: ${u})`,
    add: `func application(
    _ application: UIApplication,
    continue userActivity: NSUserActivity,
    restorationHandler: @escaping ([UIUserActivityRestoring]?) -> Void
  ) -> Bool {
    LucentAppDelegate.application(application, continue: userActivity) ${FORWARD}
  }`,
  },
  {
    method: "application(_:didRegisterForRemoteNotificationsWithDeviceToken:)",
    labels: ["application", "deviceToken"],
    find: app([["didRegisterForRemoteNotificationsWithDeviceToken", "Data"]]),
    line: ([a, t]) =>
      `LucentAppDelegate.application(${a}, didRegisterForRemoteNotificationsWithDeviceToken: ${t})`,
    add: `func application(
    _ application: UIApplication,
    didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
  ) {
    LucentAppDelegate.application(application, didRegisterForRemoteNotificationsWithDeviceToken: deviceToken) ${FORWARD}
  }`,
  },
  {
    method: "application(_:didFailToRegisterForRemoteNotificationsWithError:)",
    labels: ["application", "error"],
    find: app([["didFailToRegisterForRemoteNotificationsWithError", "(?:any\\s+)?Error"]]),
    line: ([a, e]) =>
      `LucentAppDelegate.application(${a}, didFailToRegisterForRemoteNotificationsWithError: ${e})`,
    add: `func application(
    _ application: UIApplication,
    didFailToRegisterForRemoteNotificationsWithError error: Error
  ) {
    LucentAppDelegate.application(application, didFailToRegisterForRemoteNotificationsWithError: error) ${FORWARD}
  }`,
  },
  {
    method: "application(_:handleEventsForBackgroundURLSession:completionHandler:)",
    labels: ["application", "identifier", "completionHandler"],
    find: app([
      ["handleEventsForBackgroundURLSession", "String"],
      ["completionHandler", "@escaping"],
    ]),
    line: ([a, i, c]) =>
      `if LucentAppDelegate.application(${a}, handleEventsForBackgroundURLSession: ${i}, completionHandler: ${c}) { return }`,
    add: `func application(
    _ application: UIApplication,
    handleEventsForBackgroundURLSession identifier: String,
    completionHandler: @escaping () -> Void
  ) {
    if !LucentAppDelegate.application(application, handleEventsForBackgroundURLSession: identifier, completionHandler: completionHandler) { completionHandler() } ${FORWARD}
  }`,
  },
  {
    method: "application(_:performActionFor:completionHandler:)",
    labels: ["application", "shortcutItem", "completionHandler"],
    find: app([
      ["performActionFor", "UIApplicationShortcutItem"],
      ["completionHandler", "@escaping"],
    ]),
    line: ([a, s, c]) =>
      `if LucentAppDelegate.application(${a}, performActionFor: ${s}, completionHandler: ${c}) { return }`,
    add: `func application(
    _ application: UIApplication,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    if !LucentAppDelegate.application(application, performActionFor: shortcutItem, completionHandler: completionHandler) { completionHandler(false) } ${FORWARD}
  }`,
  },
];

const scene = (name: string, parts: [string, string][]) => signature(name, parts);

/** What a scene delegate forwards. */
export const SCENE_FORWARDS: (Forward & { labels: string[] })[] = [
  {
    method: "scene(_:willConnectTo:options:)",
    labels: ["scene", "session", "connectionOptions"],
    find: scene("scene", [
      ["_", "UIScene"],
      ["willConnectTo", "UISceneSession"],
      ["options", "UIScene\\.ConnectionOptions"],
    ]),
    line: ([s, , o]) => `LucentAppDelegate.scene(${s}, willConnectWithOptions: ${o})`,
    add: `func scene(
    _ scene: UIScene,
    willConnectTo session: UISceneSession,
    options connectionOptions: UIScene.ConnectionOptions
  ) {
    LucentAppDelegate.scene(scene, willConnectWithOptions: connectionOptions) ${FORWARD}
  }`,
  },
  {
    method: "scene(_:openURLContexts:)",
    labels: ["scene", "URLContexts"],
    find: scene("scene", [
      ["_", "UIScene"],
      ["openURLContexts", "Set"],
    ]),
    line: ([s, u]) => `_ = LucentAppDelegate.scene(${s}, openURLContexts: ${u})`,
    add: `func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
    _ = LucentAppDelegate.scene(scene, openURLContexts: URLContexts) ${FORWARD}
  }`,
  },
  {
    method: "scene(_:continue:)",
    labels: ["scene", "userActivity"],
    find: scene("scene", [
      ["_", "UIScene"],
      ["continue", "NSUserActivity"],
    ]),
    line: ([s, u]) => `_ = LucentAppDelegate.scene(${s}, continue: ${u})`,
    add: `func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
    _ = LucentAppDelegate.scene(scene, continue: userActivity) ${FORWARD}
  }`,
  },
  {
    method: "windowScene(_:performActionFor:completionHandler:)",
    labels: ["windowScene", "shortcutItem", "completionHandler"],
    find: scene("windowScene", [
      ["_", "UIWindowScene"],
      ["performActionFor", "UIApplicationShortcutItem"],
      ["completionHandler", "@escaping"],
    ]),
    line: ([w, s, c]) =>
      `if LucentAppDelegate.windowScene(${w}, performActionFor: ${s}, completionHandler: ${c}) { return }`,
    add: `func windowScene(
    _ windowScene: UIWindowScene,
    performActionFor shortcutItem: UIApplicationShortcutItem,
    completionHandler: @escaping (Bool) -> Void
  ) {
    if !LucentAppDelegate.windowScene(windowScene, performActionFor: shortcutItem, completionHandler: completionHandler) { completionHandler(false) } ${FORWARD}
  }`,
  },
];

/**
 * What the app adds when a module listens, since added unasked they would
 * change the app: the events, and the method to add to the app delegate.
 */
export const OPTIONAL_FORWARDS: {
  events: string[];
  method: string;
  find: RegExp;
  snippet: string;
}[] = [
  {
    events: ["remoteNotification"],
    method: "application(_:didReceiveRemoteNotification:fetchCompletionHandler:)",
    find: app([["didReceiveRemoteNotification", "\\["]]),
    snippet: `func application(
    _ application: UIApplication,
    didReceiveRemoteNotification userInfo: [AnyHashable: Any],
    fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    if !LucentAppDelegate.application(application, didReceiveRemoteNotification: userInfo, fetchCompletionHandler: completionHandler) { completionHandler(.noData) } ${FORWARD}
  }`,
  },
  {
    events: ["backgroundFetch"],
    method: "application(_:performFetchWithCompletionHandler:)",
    find: app([["performFetchWithCompletionHandler", "@escaping"]]),
    snippet: `func application(
    _ application: UIApplication,
    performFetchWithCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
  ) {
    if !LucentAppDelegate.application(application, performFetchWithCompletionHandler: completionHandler) { completionHandler(.noData) } ${FORWARD}
  }`,
  },
  {
    events: ["supportedInterfaceOrientations"],
    method: "application(_:supportedInterfaceOrientationsFor:)",
    find: app([["supportedInterfaceOrientationsFor", "UIWindow"]]),
    snippet: `func application(
    _ application: UIApplication,
    supportedInterfaceOrientationsFor window: UIWindow?
  ) -> UIInterfaceOrientationMask {
    LucentAppDelegate.application(application, supportedInterfaceOrientationsFor: window, defaultMask: []) ${FORWARD}
  }`,
  },
];

/** The class in `text` that adopts `protocol`: where its body opens, and where it closes. */
function classBody(text: string, protocol: RegExp): { open: number; close: number } | undefined {
  const declared = new RegExp(`class\\s+\\w+\\s*:[^{]*\\b(?:${protocol.source})\\b[^{]*\\{`).exec(
    text,
  );
  if (!declared) return undefined;
  const open = declared.index + declared[0].length - 1;
  const close = matchingBrace(text, open);
  return close === undefined ? undefined : { open, close };
}

/** The `}` that closes the `{` at `open`, past strings and comments. */
function matchingBrace(text: string, open: number): number | undefined {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    const c = text[i];
    if (c === "/" && text[i + 1] === "/")
      i = text.indexOf("\n", i) < 0 ? text.length : text.indexOf("\n", i);
    else if (c === "/" && text[i + 1] === "*") i = text.indexOf("*/", i + 2) + 1 || text.length;
    else if (c === '"') {
      const triple = text.startsWith('"""', i);
      const end = triple ? text.indexOf('"""', i + 3) + 2 : stringEnd(text, i);
      if (end <= i) return undefined;
      i = end;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i;
  }
  return undefined;
}

/** The closing quote of the one-line string at `start`. */
function stringEnd(text: string, start: number): number {
  for (let i = start + 1; i < text.length; i++) {
    if (text[i] === "\\") i++;
    else if (text[i] === '"') return i;
    else if (text[i] === "\n") return -1;
  }
  return -1;
}

/**
 * `text` (a Swift delegate) with its forwarding: each of `forwards`, a line
 * in the method it has or the method added, and `import LucentNative`.
 * Unchanged when every one is there already; undefined when no class in it
 * adopts `protocol`.
 */
export function withForwards(
  text: string,
  protocol: RegExp,
  forwards: (Forward & { labels: string[] })[],
): string | undefined {
  if (!classBody(text, protocol)) return undefined;
  let out = text;

  const added: string[] = [];
  for (const f of forwards) {
    const found = f.find.exec(out);
    if (!found) {
      added.push(f.add);
      continue;
    }
    const open = out.indexOf("{", found.index + found[0].length);
    const close = open < 0 ? undefined : matchingBrace(out, open);
    if (close === undefined) continue;
    // Already forwarded: Lucent's line is in its body.
    if (out.slice(open, close).includes(FORWARD)) continue;

    const indent = /\n([ \t]*)\S/.exec(out.slice(open, close))?.[1] ?? "    ";
    const line = `\n${indent}${f.line(namesOf(found, f.labels))} ${FORWARD}`;
    // A body that was one expression returned it: with a line before it, it says so.
    const body = out.slice(open + 1, close);
    const returns = out.slice(found.index, open).includes("->");
    const statements = body.split("\n").filter((l) => l.trim() && !l.trim().startsWith("//"));
    const only = statements.length === 1 ? statements[0]! : undefined;
    const lone =
      returns && only && !/^\s*(return|if|guard|switch|let|var|for|while|do|throw|#)/.test(only)
        ? only
        : undefined;
    const rest = lone ? body.replace(lone, lone.replace(/^(\s*)/, "$1return ")) : body;
    out = out.slice(0, open + 1) + line + rest + out.slice(close);
  }

  if (added.length) {
    const body = classBody(out, protocol)!;
    const methods = added.map((m) => `  ${ADDED}\n  ${m}\n  ${ADDED_END}\n`).join("");
    const before = out.slice(0, body.close).replace(/\s*$/, "\n");
    out = before + methods + out.slice(body.close);
  }

  if (!out.includes(IMPORT)) {
    const imports = [...out.matchAll(/^import\s+\S+.*$/gm)];
    const last = imports.at(-1);
    const at = last ? last.index! + last[0].length : 0;
    out = `${out.slice(0, at)}${last ? "\n" : ""}${IMPORT}${last ? "" : "\n"}${out.slice(at)}`;
  }
  return out;
}

/** `text` without what withForwards added. */
export function withoutForwards(text: string): string {
  let out = text;
  for (;;) {
    const begin = out.indexOf(ADDED);
    if (begin < 0) break;
    const end = out.indexOf(ADDED_END, begin);
    if (end < 0) break;
    const from = out.lastIndexOf("\n", begin);
    const to = out.indexOf("\n", end);
    out = out.slice(0, from < 0 ? 0 : from) + (to < 0 ? "" : out.slice(to));
  }
  return out
    .split("\n")
    .filter((l) => !l.trimEnd().endsWith(FORWARD))
    .join("\n");
}

/** The app delegate's protocol, and a scene delegate's. */
export const APP_DELEGATE = /UIApplicationDelegate/;
export const SCENE_DELEGATE = /UIWindowSceneDelegate|UISceneDelegate/;

/** Which forwards `text` lacks, by method: none when Lucent's line is in each. */
export function missingForwards(
  text: string,
  forwards: (Forward & { labels: string[] })[],
): string[] {
  return forwards
    .filter((f) => {
      const found = f.find.exec(text);
      if (!found) return true;
      const open = text.indexOf("{", found.index + found[0].length);
      const close = open < 0 ? undefined : matchingBrace(text, open);
      return close === undefined || !text.slice(open, close).includes(FORWARD);
    })
    .map((f) => f.method);
}

/**
 * The app's delegates under `root`'s ios/: its Swift AppDelegate and
 * SceneDelegate, or its Objective-C AppDelegate, relative to `root`.
 */
export function appDelegates(root: string): { app?: string; scene?: string; objc?: string } {
  const ios = path.join(root, "ios");
  if (!fs.existsSync(ios)) return {};
  const found = (name: string) =>
    fs
      .readdirSync(ios, { withFileTypes: true })
      .filter(
        (e) =>
          e.isDirectory() && !e.name.startsWith(".") && e.name !== "Pods" && e.name !== "build",
      )
      .map((e) => path.join("ios", e.name, name))
      .find((f) => fs.existsSync(path.join(root, f)));
  return {
    app: found("AppDelegate.swift"),
    scene: found("SceneDelegate.swift"),
    objc: found("AppDelegate.swift")
      ? undefined
      : (found("AppDelegate.mm") ?? found("AppDelegate.m")),
  };
}

/** For each event that a forward the app may lack carries: the app delegate's method, and a scene delegate's. */
const EVENT_FORWARDS: Record<string, { app: string; scene?: string }> = {
  openURL: { app: "application(_:open:options:)", scene: "scene(_:openURLContexts:)" },
  userActivity: { app: "application(_:continue:restorationHandler:)", scene: "scene(_:continue:)" },
  shortcutItem: {
    app: "application(_:performActionFor:completionHandler:)",
    scene: "windowScene(_:performActionFor:completionHandler:)",
  },
  pushToken: { app: "application(_:didRegisterForRemoteNotificationsWithDeviceToken:)" },
  pushTokenFailed: { app: "application(_:didFailToRegisterForRemoteNotificationsWithError:)" },
  backgroundURLSession: {
    app: "application(_:handleEventsForBackgroundURLSession:completionHandler:)",
  },
};

/** Whether `text` has `find`'s method, with Lucent's line in its body. */
function forwarded(text: string, find: RegExp): boolean {
  const found = find.exec(text);
  if (!found) return false;
  const open = text.indexOf("{", found.index + found[0].length);
  const close = open < 0 ? undefined : matchingBrace(text, open);
  return close !== undefined && text.slice(open, close).includes(FORWARD);
}

/**
 * What a bare app's delegates must forward for the app delegate's
 * `events` that its modules listen for (the compiler's
 * appDelegateEvents), and don't: one warning each, saying what to run or
 * add. An Expo app's subscriber forwards them all.
 */
export function missingDelegateForwards(
  root: string,
  events: string[],
  expo: boolean,
): { level: "warn"; text: string }[] {
  if (expo || !events.length) return [];
  const { app, scene, objc } = appDelegates(root);
  const read = (file: string) => fs.readFileSync(path.join(root, file), "utf8");
  const listens = (event: string) => `a module listens for onAppEvent("${event}")`;
  if (objc && !read(objc).includes("LucentAppDelegate"))
    return [
      {
        level: "warn",
        text: `${listens(events[0]!)}, but ${objc} doesn't call LucentAppDelegate: call it first in each delegate method (lucent init prints the lines)`,
      },
    ];
  if (!app) return [];

  const out: { level: "warn"; text: string }[] = [];
  const appText = read(app);
  const sceneText = scene ? read(scene) : undefined;
  for (const event of events) {
    const optional = OPTIONAL_FORWARDS.find((f) => f.events.includes(event));
    if (optional) {
      if (!forwarded(appText, optional.find))
        out.push({
          level: "warn",
          text: `${listens(event)}, but ${app} doesn't forward ${optional.method} to it. Add:\n  ${optional.snippet}`,
        });
      continue;
    }
    const needs = EVENT_FORWARDS[event];
    if (!needs) continue;
    // In an app with scenes, UIKit gives URLs, activities and shortcuts to the scene delegate.
    const [file, text, method, forwards] =
      needs.scene && sceneText !== undefined
        ? [scene!, sceneText, needs.scene, SCENE_FORWARDS]
        : [app, appText, needs.app, APP_FORWARDS];
    if (missingForwards(text, forwards).includes(method))
      out.push({
        level: "warn",
        text: `${listens(event)}, but ${file} doesn't forward ${method} to it: run lucent init, which adds the call`,
      });
  }
  return out;
}

/** Whether the app at `root` is an Expo app: Expo's AppDelegate forwards to Lucent's subscriber. */
export function isExpoApp(root: string): boolean {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return "expo" in { ...pkg.dependencies, ...pkg.devDependencies };
  } catch {
    return false;
  }
}
