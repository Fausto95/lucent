import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { podsSearchPaths, sdkAvailable } from "@lucent-lang/bindgen";
import { fileURLToPath } from "node:url";
import { compile, runtimeDir, type SdkOptions } from "../src/index.ts";

/** iOS output for a platform module whose iOS side is `src` (exporting run()). */
function ios(src: string, sdk?: SdkOptions) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-ios-"));
  const files = {
    "m.lucent.ts": "export declare function run(): Promise<string>;\n",
    "m.ios.lucent.ts": src,
    "m.android.lucent.ts": 'export async function run(): Promise<string> {\n  return "";\n}\n',
  };
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  const r = compile(Object.keys(files).map((f) => path.join(dir, f)), { platforms: ["ios"], sdk });
  return { r, mm: r.files.get("ios/m_m.mm") ?? "", dir };
}

const clipboard = `import { UIPasteboard } from "lucent:ios/UIKit";
import { main } from "lucent:thread";
export function run(): Promise<string> {
  return main(() => {
    const board = UIPasteboard.general;
    // Optional calls of void methods are values too.
    (null as UIPasteboard | null)?.setData(new Uint8Array(0), "public.data");
    board.string = "hello";
    board.strings = ["a", "b"];
    return \`\${board.string ?? ""} \${board.hasStrings}\`;
  });
}
`;

const files = `import { FileAttributeKey, FileManager, FileManager_SearchPathDirectory as Dir, FileManager_SearchPathDomainMask as Mask, ProcessInfo } from "lucent:ios/Foundation";
import { asDate, asNumber } from "lucent:ios";
import { errorCode } from "@lucent-lang/core";
export async function run(): Promise<string> {
  const fm = FileManager.default;
  const dir = fm.urls(Dir.documentDirectory, Mask.userDomainMask)[0]?.path ?? "";
  fm.createFile(\`\${dir}/a.bin\`, new Uint8Array([1, 2]), null);
  const bytes = fm.contents(\`\${dir}/a.bin\`);
  const attrs = fm.attributesOfItem(\`\${dir}/a.bin\`);
  const created = asDate(attrs[FileAttributeKey.creationDate] ?? null);
  const size = asNumber(attrs[FileAttributeKey.size] ?? null);
  let missing = "";
  try {
    fm.attributesOfItem("/no/such/file");
  } catch (e) {
    missing = errorCode(e as Error) ?? "";
  }
  return \`\${bytes?.length} \${size} \${created?.getTime()} \${missing} \${ProcessInfo.processInfo.physicalMemory > 0}\`;
}
`;

const keychain = `import { kSecAttrService, kSecClass, kSecClassGenericPassword, kSecMatchLimit, kSecMatchLimitOne, kSecReturnData, SecItemCopyMatching } from "lucent:ios/Security";
import { Bundle } from "lucent:ios/Foundation";
import { asData, asString, type NSObject, type ObjCValue, Out } from "lucent:ios";
export async function run(): Promise<string> {
  const query: Record<string, ObjCValue> = {};
  query[kSecClass] = kSecClassGenericPassword;
  query[kSecAttrService] = "lucent";
  query[kSecReturnData] = true;
  query[kSecMatchLimit] = kSecMatchLimitOne;
  const result = new Out<NSObject>();
  const status = SecItemCopyMatching(query, result);
  const name = asString(Bundle.main.object("CFBundleName"));
  return \`\${status} \${asData(result.value)?.length} \${name}\`;
}
`;

const pods = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../bindgen/test/fixtures/pods");

const gauge = `import { WPGauge, WPGaugeMode } from "lucent:ios/WidgetsPod";
import type { NSURL } from "lucent:ios/Foundation";
export async function run(): Promise<string> {
  const g = new WPGauge(WPGaugeMode.radial);
  g.value = 2;
  const docs: NSURL = g.documentation;
  return \`\${g.value} \${typeof docs} \${docs !== null}\`;
}
`;

const callbacks = `import { UIView } from "lucent:ios/UIKit";
import { ComparisonResult, NSSortDescriptor, Timer } from "lucent:ios/Foundation";
import { main } from "lucent:thread";
export async function run(): Promise<string> {
  let fired = 0;
  // Escaping and @Sendable: queued on the Lucent thread.
  Timer.scheduledTimer(0.01, false, (t) => {
    fired++;
    t.invalidate();
  });
  // The platform waits for the comparator's result.
  const sorter = new NSSortDescriptor(null, true, (a, b) => (a === b ? ComparisonResult.orderedSame : ComparisonResult.orderedAscending));
  const order = sorter.compare("a", "b");
  await main(() => {
    const view = new UIView();
    // Not @Sendable, in a main-actor method: on the main thread, where UIKit may be used.
    UIView.animate(0.1, () => {
      view.alpha = 0;
    }, (finished) => {
      view.alpha = finished ? 1 : 0.5;
    });
  });
  return \`\${fired} \${order}\`;
}
`;

const errorOut = `import { LAContext, LAPolicy } from "lucent:ios/LocalAuthentication";
import { Out } from "lucent:ios";
import { errorCode } from "@lucent-lang/core";
export async function run(): Promise<string> {
  const error = new Out<Error>();
  const ok = new LAContext().canEvaluatePolicy(LAPolicy.deviceOwnerAuthenticationWithBiometrics, error);
  const e = error.value;
  return \`\${ok} \${e ? errorCode(e) : "none"} \${e?.message ?? ""}\`;
}
`;

const structs = `import { CLLocation, CLLocationCoordinate2DIsValid } from "lucent:ios/CoreLocation";
export async function run(): Promise<string> {
  const location = new CLLocation(48.85, 2.35);
  const c = location.coordinate;
  const moved = { latitude: c.latitude + 1, longitude: c.longitude };
  return \`\${c.latitude},\${c.longitude} \${CLLocationCoordinate2DIsValid(moved)}\`;
}
`;

const unimportedStruct = `import { UITableView } from "lucent:ios/UIKit";
import { main } from "lucent:thread";
export async function run(): Promise<string> {
  return main(() => {
    const t = new UITableView({ origin: { x: 0, y: 0 }, size: { width: 10, height: 10 } }, 0);
    return \`\${t.bounds.size.width}\`;
  });
}
`;

const mediaTimes = `import { AVPlayer } from "lucent:ios/AVFoundation";
import { CMTimeCompare, CMTimeMake } from "lucent:ios/CoreMedia";
import { NSUnionRange } from "lucent:ios/Foundation";
import { main } from "lucent:thread";
export async function run(): Promise<string> {
  const now = await main(() => new AVPlayer().currentTime());
  const later = CMTimeMake(now.value + 600, 600);
  const r = NSUnionRange({ location: 0, length: 2 }, { location: 5, length: 1 });
  return \`\${later.value}/\${later.timescale} \${later.flags} \${CMTimeCompare(later, now)} \${r.location}+\${r.length}\`;
}
`;

const shadowing = `import { CLLocationManager, type CLLocationManagerDelegate } from "lucent:ios/CoreLocation";
import { main } from "lucent:thread";
class D implements CLLocationManagerDelegate {}
export async function run(): Promise<string> {
  // Lucent names that are Objective-C's, or look like the glue's temporaries.
  const id = 1;
  const YES = 2;
  const nil = 3;
  const v_ = new D();
  return main(() => {
    const r_ = new CLLocationManager();
    r_.delegate = v_;
    return \`\${id + YES + nil} \${r_.delegate !== null}\`;
  });
}
`;

const pathMonitor = `import { nw_interface_type_t, nw_path_get_status, nw_path_monitor_create, nw_path_monitor_set_queue, nw_path_monitor_set_update_handler, nw_path_monitor_start, nw_path_status_t, nw_path_uses_interface_type } from "lucent:ios/Network";
import { mainQueue } from "lucent:ios";
export function run(): Promise<string> {
  return new Promise((resolve) => {
    const monitor = nw_path_monitor_create();
    nw_path_monitor_set_update_handler(monitor, (path) => {
      const connected = nw_path_get_status(path) === nw_path_status_t.nw_path_status_satisfied;
      resolve(\`\${connected} \${nw_path_uses_interface_type(path, nw_interface_type_t.nw_interface_type_wifi)}\`);
    });
    nw_path_monitor_set_queue(monitor, mainQueue());
    nw_path_monitor_start(monitor);
  });
}
`;

const promises = `import { LAContext, LAPolicy } from "lucent:ios/LocalAuthentication";
import { UNUserNotificationCenter } from "lucent:ios/UserNotifications";
import { errorCode } from "@lucent-lang/core";
export async function run(): Promise<string> {
  // The async form's own name; a promise of nothing.
  const center = UNUserNotificationCenter.current();
  const pending = await center.pendingNotificationRequests();
  if (pending.length > 0) await center.add(pending[0]!);
  try {
    const ok = await new LAContext().evaluatePolicy(LAPolicy.deviceOwnerAuthenticationWithBiometrics, "Unlock");
    return \`ok \${ok}\`;
  } catch (e) {
    return errorCode(e as Error) ?? "failed";
  }
}
`;

const delegate = `import { CLLocation, CLLocationManager, type CLLocationManagerDelegate } from "lucent:ios/CoreLocation";
import { main } from "lucent:thread";
class Tracker implements CLLocationManagerDelegate {
  updates = 0;
  failures = 0;
  locationManager_didUpdateLocations(manager: CLLocationManager, locations: CLLocation[]): void {
    this.updates += locations.length;
  }
  locationManager_didFailWithError(manager: CLLocationManager, error: Error): void {
    this.failures++;
  }
}
export async function run(): Promise<string> {
  const tracker = new Tracker();
  return main(() => {
    const manager = new CLLocationManager();
    // A weak property: the manager keeps the delegate alive.
    manager.delegate = tracker;
    manager.requestWhenInUseAuthorization();
    return \`\${tracker.updates} \${tracker.failures} \${manager.delegate !== null}\`;
  });
}
`;

describe.skipIf(!sdkAvailable("ios"))("iOS bindings from the SDK", () => {
  it("reads and writes properties", () => {
    const { r, mm } = ios(clipboard);
    expect(r.diagnostics).toEqual([]);
    expect(mm).toContain("[UIPasteboard generalPasteboard]");
    expect(mm).toContain("setString:");
    // strings is nullable: absent clears the pasteboard's strings.
    expect(mm).toMatch(/setStrings:lucent::objc::ifPresent\(.*lucent::objc::toNSArray/);
  });

  it("copies Data, arrays and dictionaries, reads Any through helpers, and throws NSErrors", () => {
    const { r, mm } = ios(files);
    expect(r.diagnostics).toEqual([]);
    expect(mm).toContain("lucent::objc::toNSData");
    expect(mm).toContain("lucent::objc::fromNSData");
    expect(mm).toContain("lucent::objc::fromNSArray");
    expect(mm).toContain("lucent::objc::fromNSDictionary");
    expect(mm).toContain("NSFileCreationDate");
    expect(mm).toContain("error:&err_");
    expect(mm).toContain("lucent::objc::throwIfError(err_)");
  });

  it("calls C functions with CoreFoundation values and out-parameters", () => {
    const { r, mm } = ios(keychain);
    expect(r.diagnostics).toEqual([]);
    expect(mm).toContain("SecItemCopyMatching(");
    expect(mm).toContain("(__bridge CFDictionaryRef)");
    expect(mm).toContain("lucent::objc::outSlot(");
    expect(mm).toContain("(__bridge NSString*)kSecClass");
  });

  it("imports a pod's module through its umbrella header and links no framework for it", () => {
    const { r, mm } = ios(gauge, { ios: podsSearchPaths(pods) });
    expect(r.diagnostics).toEqual([]);
    expect(mm).toContain("#import <WidgetsPod/WidgetsPod-umbrella.h>");
    expect(mm).not.toContain("<WidgetsPod/WidgetsPod.h>");
    expect(r.frameworks).not.toContain("WidgetsPod");
  });

  it("passes functions as blocks: queued, or run while the platform waits", () => {
    const { r, mm } = ios(callbacks);
    expect(r.diagnostics).toEqual([]);
    // Heap blocks made from C++ lambdas, which own the Lucent function.
    expect(mm).toMatch(/block:lucent::objc::block<void \(\^\)\(NSTimer\*\)>\(\[f_ = [^]*?\]\(NSTimer\* a0_\) \{ lucent::postCallback\(\[f_, a0_\]/);
    expect(mm).toMatch(/comparator:lucent::objc::block<NSComparisonResult \(\^\)\(id, id\)>\([^]*?\(id a0_, id a1_\) \{ return lucent::callNow\(/);
    expect(mm).toMatch(/animations:lucent::objc::block<void \(\^\)\(\)>\([^]*?\]\(\) \{ lucent::callNow\(/);
  });

  it("calls completion-handler methods as promises, settled on the Lucent thread", () => {
    const { r, mm } = ios(promises);
    expect(r.diagnostics).toEqual([]);
    expect(mm).toMatch(/evaluatePolicy:.* localizedReason:.* reply:lucent::objc::block<void \(\^\)\(BOOL, NSError\*\)>\(\[p_\]\(BOOL a0_, NSError\* a1_\) \{ lucent::postCallback\(/);
    expect(mm).toContain("p_.reject(lucent::objc::fromNSError(a1_");
    expect(mm).toContain("p_.resolve(static_cast<bool>(a0_))");
    expect(mm).toContain("getPendingNotificationRequestsWithCompletionHandler:lucent::objc::block<");
    expect(mm).toContain("p_.resolve(lucent::undefined)");
  });

  it("implements protocols with Lucent classes, retained by the objects they delegate for", () => {
    const { r, mm } = ios(delegate);
    expect(r.diagnostics).toEqual([]);
    expect(mm).toMatch(/@interface LucentTracker : NSObject <CLLocationManagerDelegate>/);
    expect(mm).toMatch(/- \(void\)locationManager:\(CLLocationManager\*\)a0_ didUpdateLocations:\(NSArray\*\)a1_ \{ lucent::postCallback\(/);
    expect(mm).toMatch(/- \(void\)locationManager:\(CLLocationManager\*\)a0_ didFailWithError:\(NSError\*\)a1_ \{/);
    expect(mm).toContain("objc_setAssociatedObject(");
  });

  it("reads NSError out-parameters as Lucent errors", () => {
    const { r, mm } = ios(errorOut);
    expect(r.diagnostics).toEqual([]);
    expect(mm).toContain("canEvaluatePolicy:");
    expect(mm).toContain("error:lucent::objc::ErrorOut(");
    expect(mm).toContain("lucent::objc::outError(");
  });

  it("reads and passes C structs by value, as Lucent objects", () => {
    const { r, mm } = ios(structs);
    expect(r.diagnostics).toEqual([]);
    // Nested structs number their temporaries (s0_, s1_…) so they do not shadow each other.
    expect(mm).toMatch(/auto s0_ = \[.*coordinate\]; auto o0_ = std::make_shared<lucent_app::S_CLLocationCoordinate2D>\(\); o0_->latitude = static_cast<double>\(s0_\.latitude\); o0_->longitude = static_cast<double>\(s0_\.longitude\);/);
    expect(mm).toContain("CLLocationCoordinate2DIsValid(CLLocationCoordinate2D{");
  });

  it("passes other modules' structs, enum fields and typedefs Swift names without a USR", () => {
    const { r, mm } = ios(mediaTimes);
    expect(r.diagnostics).toEqual([]);
    expect(mm).toContain("CMTimeMake(");
    // Fields take their own C types: an option set, and NSUInteger where Swift says Int.
    expect(mm).toContain("static_cast<decltype(CMTime::flags)>(");
    expect(mm).toContain("static_cast<decltype(NSRange::length)>(");
    expect(mm).toContain("NSUnionRange(NSRange{");
  });

  it("passes structs of modules the program does not import (CGRect, through UIKit)", () => {
    const { r, mm } = ios(unimportedStruct);
    expect(r.diagnostics).toEqual([]);
    expect(mm).toContain("initWithFrame:CGRect{CGPoint{");
  });

  it("monitors network paths: OS objects, anonymous enums, blocks, the main queue", () => {
    const { r, mm } = ios(pathMonitor);
    expect(r.diagnostics).toEqual([]);
    expect(mm).toContain("nw_path_monitor_set_queue(");
    expect(mm).toContain("lucent::objc::mainQueue()");
  });

  it("allows main-thread APIs only in blocks that run on the main thread", () => {
    const { r } = ios(`import { UIView } from "lucent:ios/UIKit";
import { Timer } from "lucent:ios/Foundation";
export async function run(): Promise<string> {
  Timer.scheduledTimer(0.01, false, () => {
    new UIView();
  });
  return "";
}
`);
    expect(r.diagnostics.map((d) => d.code)).toEqual(["LUCENT3006"]);
  });

  it("generates Objective-C++ that compiles against the iOS SDK", () => {
    const sdk = spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"], { encoding: "utf8" });
    if (process.platform !== "darwin" || sdk.status !== 0) return;
    for (const [src, sdk] of [[clipboard], [files], [keychain], [callbacks], [promises], [delegate], [errorOut], [structs], [unimportedStruct], [mediaTimes], [shadowing], [pathMonitor], [gauge, { ios: podsSearchPaths(pods) }]] as [string, SdkOptions?][]) {
      const { r, dir } = ios(src, sdk);
      expect(r.diagnostics).toEqual([]);
      for (const [k, v] of r.files) {
        fs.mkdirSync(path.dirname(path.join(dir, "out", k)), { recursive: true });
        fs.writeFileSync(path.join(dir, "out", k), v);
      }
      const cc = spawnSync(
        "xcrun",
        ["--sdk", "iphonesimulator", "clang++", "-std=c++20", "-fobjc-arc", "-fsyntax-only", "-target", "arm64-apple-ios15.1-simulator", "-Werror", "-Wno-gnu-statement-expression", "-Wno-unused-label", "-Wno-parentheses-equality", "-Wno-comma", `-I${path.join(runtimeDir(), "cpp")}`, `-I${path.join(dir, "out/ios")}`, `-I${path.join(pods, "Pods/Headers/Public")}`, "-x", "objective-c++", path.join(dir, "out/ios/m_m.mm")],
        { encoding: "utf8" },
      );
      expect(cc.stderr).toBe("");
    }
  });
});
