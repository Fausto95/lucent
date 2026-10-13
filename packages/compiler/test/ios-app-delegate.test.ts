/**
 * What the app delegate and the scene delegate forward to Lucent
 * (LucentAppDelegate): onAppEvent's delegate events, each subscribed with
 * its own runtime function and listener. Typed from an empty schema set:
 * the generated code is checked anywhere.
 */
import { describe, expect, it } from "vite-plus/test";
import { schemaSet, setProgram } from "./schema-set.ts";

describe("app delegate events", () => {
  it("subscribes to what the app delegate forwards, each event with its own listener", () => {
    const p = setProgram(
      `import { onAppEvent, type FetchResult } from "lucent:ios";
export async function run(): Promise<string> {
  const heard: string[] = [];
  const stops = [
    onAppEvent("openURL", (url, source) => {
      heard.push(url + source);
      return url.startsWith("lucent:");
    }),
    onAppEvent("userActivity", (type, url, info) => type === "web" && url.length + info.length > 0),
    onAppEvent("shortcutItem", (type, title, info) => title.length > 0),
    onAppEvent("pushToken", (token) => {
      heard.push(\`\${token.length}\`);
    }),
    onAppEvent("pushTokenFailed", (error) => {
      heard.push(error.message);
    }),
    onAppEvent("remoteNotification", async (info): Promise<FetchResult> => (info.length > 2 ? "newData" : "noData")),
    onAppEvent("backgroundFetch", async (): Promise<FetchResult> => "failed"),
    onAppEvent("backgroundURLSession", (identifier, done) => {
      done();
      return identifier === "lucent.downloads";
    }),
    onAppEvent("supportedInterfaceOrientations", () => 2),
    onAppEvent("didBecomeActive", () => {}),
  ];
  for (const stop of stops) stop();
  return heard.join(",");
}
`,
      schemaSet([]),
    );
    const mm = p.mm;
    expect(p.messages).toEqual([]);
    expect(mm).toContain("#include <lucent/platform/ios_app_delegate.h>");
    for (const fn of [
      "onOpenURL",
      "onUserActivity",
      "onShortcutItem",
      "onPushToken",
      "onPushTokenFailed",
      "onRemoteNotification",
      "onBackgroundFetch",
      "onBackgroundURLSession",
      "onSupportedInterfaceOrientations",
    ])
      expect(mm).toContain(`lucent::objc::${fn}(`);
    expect(mm).toContain('lucent::objc::onAppEvent(LUCENT_STR("didBecomeActive")');
    // What the app's delegates must forward, for lucent build to check.
    expect(p.r.appDelegateEvents).toEqual([
      "backgroundFetch",
      "backgroundURLSession",
      "openURL",
      "pushToken",
      "pushTokenFailed",
      "remoteNotification",
      "shortcutItem",
      "supportedInterfaceOrientations",
      "userActivity",
    ]);
  });
});
