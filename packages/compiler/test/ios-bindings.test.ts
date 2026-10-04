import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
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
  const r = compile(
    Object.keys(files).map((f) => path.join(dir, f)),
    { platforms: ["ios"], sdk },
  );
  // Whitespace collapsed: the assertions are about the code, not its layout.
  return { r, mm: (r.files.get("ios/m_m.mm") ?? "").replace(/\s+/g, " "), dir };
}

const caches = `import { NSCache } from "lucent:ios/Foundation";
import { UIImage } from "lucent:ios/UIKit";
export async function run(): Promise<string> {
  const names = new NSCache<string, string>();
  names.setObject("Ada", "first");
  const sizes = new NSCache<string, number>();
  sizes.setObject(3, "count");
  const images = new NSCache<string, UIImage>();
  const image = images.object("none");
  return \`\${names.object("first") ?? "none"} \${sizes.object("count") ?? 0} \${image === null}\`;
}
`;

const blockArgs = `import {
  InputStream,
  NSFileCoordinator,
  NSFileCoordinator_ReadingOptions,
  NSFileCoordinator_WritingOptions,
  URLSession,
  URLSessionTask,
  URLSessionTaskDelegate,
} from "lucent:ios/Foundation";
import { SecRequestSharedWebCredential } from "lucent:ios/Security";
class Uploads implements URLSessionTaskDelegate {
  asked = 0;
  urlSession_task_needNewBodyStream(
    session: URLSession,
    task: URLSessionTask,
    completionHandler: (arg0: InputStream | null) => void,
  ): void {
    this.asked += 1;
    completionHandler(null);
  }
}
export async function run(): Promise<string> {
  // A block that takes a block: the accessor gets a completion handler to call.
  let prepared = 0;
  const reading = NSFileCoordinator_ReadingOptions.withoutChanges;
  const writing = NSFileCoordinator_WritingOptions.forMerging;
  new NSFileCoordinator(null).prepare([], reading, [], writing, null, (done) => {
    prepared += 1;
    done();
  });
  // A block that takes CoreFoundation values.
  let shared = -1;
  SecRequestSharedWebCredential(null, null, (credentials, error) => {
    shared = error === null ? (credentials?.length ?? 0) : -2;
  });
  return \`\${new Uploads().asked} \${prepared} \${shared}\`;
}
`;

const outParams = `import { NSLayoutManager, UIColor } from "lucent:ios/UIKit";
import {
  NSCalendar,
  NSCalendar_Unit,
  NSRange,
  PropertyListSerialization,
  PropertyListSerialization_MutabilityOptions,
  PropertyListSerialization_PropertyListFormat,
} from "lucent:ios/Foundation";
import { Out } from "lucent:ios";
import { main } from "lucent:thread";
export async function run(): Promise<string> {
  // Numbers, one pointer left out.
  const red = new Out<number>();
  const alpha = new Out<number>();
  const ok = UIColor.red.getRed(red, null, null, alpha);
  // A date and a number.
  const start = new Out<Date>();
  const interval = new Out<number>();
  const found = NSCalendar.current.range(NSCalendar_Unit.day, start, interval, new Date());
  // An enum.
  const format = new Out<PropertyListSerialization_PropertyListFormat>();
  const options = PropertyListSerialization_MutabilityOptions.mutableContainers;
  const plist = PropertyListSerialization.propertyList(new Uint8Array(0), options, format);
  // A struct, inout: its value goes in, and the method's comes out.
  const effective = new Out<NSRange>();
  effective.value = { location: 0n, length: 0n };
  const container = await main(() => new NSLayoutManager().textContainer(0n, effective));
  return \`\${ok} \${red.value} \${alpha.value} \${found} \${start.value?.getTime()} \${interval.value} \${format.value} \${plist === null} \${container === null} \${effective.value?.length}\`;
}
`;

const enumeration = `import {
  NSCalendar,
  NSCalendar_Options,
  NSDateComponents,
} from "lucent:ios/Foundation";
export async function run(): Promise<string> {
  const nine = new NSDateComponents();
  nine.hour = 9n;
  // The block gets BOOL *stop as an Out it sets: the calendar reads it after each date.
  let seen = 0;
  NSCalendar.current.enumerateDates(new Date(), nine, NSCalendar_Options.matchNextTime, (date, exact, stop) => {
    seen += 1;
    if (seen === 2) stop.value = true;
  });
  return \`\${seen}\`;
}
`;

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
import { errorCode } from "lucent:core";
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

const pods = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../bindgen/test/fixtures/pods",
);

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
import { errorCode } from "lucent:core";
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

/** CoreGraphics' C functions as Swift imports them: members of their handles. */
const cgMembers = `import { UIImage } from "lucent:ios/UIKit";
import { main } from "lucent:thread";
export async function run(): Promise<string> {
  return main(() => {
    const cg = new UIImage(new Uint8Array(0)).cgImage;
    if (cg === null) return "none";
    const cropped = cg.cropping({ origin: { x: 0, y: 0 }, size: { width: 1, height: 1 } });
    return \`\${cg.width}x\${cg.height} \${cropped === null}\`;
  });
}
`;

const cgImages = `import { UIImage } from "lucent:ios/UIKit";
import { CIContext, CIImage } from "lucent:ios/CoreImage";
import { main } from "lucent:thread";
export async function run(): Promise<string> {
  return main(() => {
    const cg = new UIImage(new Uint8Array(0)).cgImage;
    if (cg === null) return "none";
    const drawn = new CIContext().createCGImage(new CIImage(cg), { origin: { x: 0, y: 0 }, size: { width: 1, height: 1 } });
    return \`\${new UIImage(cg).size.width} \${drawn === null}\`;
  });
}
`;

const sets = `import { UIApplication, UIEvent, UIView, type UITouch } from "lucent:ios/UIKit";
import { main } from "lucent:thread";
export async function run(): Promise<string> {
  return main(() => {
    const scenes = UIApplication.shared.connectedScenes;
    new UIView().touchesBegan(new Set<UITouch>(), new UIEvent());
    return \`\${scenes.size}\`;
  });
}
`;

// Names Apple's headers define as macros (MIN in Foundation, pascal and
// TRUE in MacTypes, isset in <sys/param.h>), as a struct, locals and a function.
const appleMacros = `import { UIView } from "lucent:ios/UIKit";
import { main } from "lucent:thread";
interface Range { MIN: number; pascal: string }
function isset(r: Range): boolean {
  return r.MIN > 0;
}
export async function run(): Promise<string> {
  const TRUE: Range = { MIN: 1, pascal: "p" };
  return main(() => {
    new UIView();
    return \`\${isset(TRUE)} \${TRUE.pascal}\`;
  });
}
`;

const mediaTimes = `import { AVPlayer } from "lucent:ios/AVFoundation";
import { CMTimeCompare, CMTimeMake } from "lucent:ios/CoreMedia";
import { NSUnionRange } from "lucent:ios/Foundation";
import { main } from "lucent:thread";
export async function run(): Promise<string> {
  const now = await main(() => new AVPlayer().currentTime());
  const later = CMTimeMake(now.value + 600n, 600);
  const r = NSUnionRange({ location: 0n, length: 2n }, { location: 5n, length: 1n });
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
import { errorCode } from "lucent:core";
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

const presenting = `import { UIActivityViewController, UIApplication, UIViewController } from "lucent:ios/UIKit";
import { Timer } from "lucent:ios/Foundation";
import { onAppEvent, onSceneEvent, present } from "lucent:ios";
let foregrounds = 0;
const scenes: string[] = [];
export async function run(): Promise<string> {
  // Listeners run on the main thread: main-only APIs need no main() there.
  const stop = onAppEvent("willEnterForeground", () => {
    foregrounds += 1;
    UIApplication.shared.isIdleTimerDisabled = false;
  });
  const controller = new AbortController();
  const stopScenes = onSceneEvent("didActivate", (scene) => {
    scenes.push(scene);
  }, controller.signal);
  // A value from the view controller's completion handler, withdrawn by a signal.
  const shared = await present<boolean>((resolve) => {
    const sheet = new UIActivityViewController(["Lucent"], null);
    sheet.completionHandler = (_type, completed) => resolve(completed);
    return sheet;
  }, controller.signal);
  // Nothing, settled from a timer on the main thread.
  await present<void>((resolve) => {
    Timer.scheduledTimer(0.5, false, () => resolve());
    return new UIViewController(null, null);
  });
  // An error.
  let failed = "";
  try {
    await present<number>((_resolve, reject) => {
      reject(new Error("no"));
      return new UIViewController(null, null);
    });
  } catch (e) {
    failed = (e as Error).message;
  }
  stop();
  stopScenes();
  return \`\${shared} \${failed} \${foregrounds} \${scenes.length}\`;
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
  }, 600_000);

  it("calls a protocol's method a class hides with its own of the same name", () => {
    const { r, mm } = ios(`import { NSLock } from "lucent:ios/Foundation";
export async function run(): Promise<string> {
  const lock = new NSLock();
  lock.lock();
  lock.unlock();
  return "ok";
}
`);

    expect(r.diagnostics).toEqual([]);

    // NSLocking's lock(), beside NSLock's lock(before:).
    expect(mm).toMatch(/\[\S+ lock\]/);
  });

  it("depends on the pod whose module it imports, so frameworks builds find its headers", () => {
    const { r } = ios(gauge, { ios: podsSearchPaths(pods) });

    expect(r.diagnostics).toEqual([]);
    expect(r.pods).toEqual(["WidgetsPod"]);
  });

  it("depends on no pod for SDK modules", () => {
    const { r } = ios(callbacks);

    expect(r.pods ?? []).toEqual([]);
  });

  it("passes functions as blocks: queued, or run while the platform waits", () => {
    const { r, mm } = ios(callbacks);
    expect(r.diagnostics).toEqual([]);
    // Heap blocks made from C++ lambdas, which own the Lucent function.
    expect(mm).toMatch(
      /block:lucent::objc::block<void \(\^\)\(NSTimer\*\)>\(\[f_ = [^]*?\]\(NSTimer\* a0_\) \{ lucent::postCallback\(\[f_, a0_\]/,
    );
    expect(mm).toMatch(
      /comparator:lucent::objc::block<NSComparisonResult \(\^\)\(id, id\)>\([^]*?\(id a0_, id a1_\) \{ return lucent::callNow\(/,
    );
    expect(mm).toMatch(
      /animations:lucent::objc::block<void \(\^\)\(\)>\([^]*?\]\(\) \{ lucent::callNow\(/,
    );
  });

  it("calls completion-handler methods as promises, settled on the Lucent thread", () => {
    const { r, mm } = ios(promises);
    expect(r.diagnostics).toEqual([]);
    expect(mm).toMatch(
      /evaluatePolicy:.* localizedReason:.* reply:lucent::objc::block<void \(\^\)\(BOOL, NSError\*\)>\(\[p_\]\(BOOL a0_, NSError\* a1_\) \{ lucent::postCallback\(/,
    );
    expect(mm).toContain("p_.reject(lucent::objc::fromNSError(a1_");
    expect(mm).toContain("p_.resolve(static_cast<bool>(a0_))");
    expect(mm).toContain(
      "getPendingNotificationRequestsWithCompletionHandler:lucent::objc::block<",
    );
    expect(mm).toContain("p_.resolve(lucent::undefined)");
  });

  it("implements protocols with Lucent classes, retained by the objects they delegate for", () => {
    const { r, mm } = ios(delegate);
    expect(r.diagnostics).toEqual([]);
    expect(mm).toMatch(/@interface LucentTracker : NSObject <CLLocationManagerDelegate>/);
    expect(mm).toMatch(
      /- \(void\)locationManager:\(CLLocationManager\*\)a0_ didUpdateLocations:\(NSArray\*\)a1_ \{ lucent::postCallback\(/,
    );
    expect(mm).toMatch(
      /- \(void\)locationManager:\(CLLocationManager\*\)a0_ didFailWithError:\(NSError\*\)a1_ \{/,
    );
    expect(mm).toContain("objc_setAssociatedObject(");
  });

  it("makes an object with a factory Swift imports as an initializer, on the class", () => {
    const widgets = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../bindgen/test/fixtures/objc",
    );
    const { r, mm } = ios(
      `import { WDGWidget } from "lucent:ios/Widgets";
import { main } from "lucent:thread";
export async function run(): Promise<string> {
  return main(() => new WDGWidget("dial").name);
}
`,
      { ios: { includePaths: [widgets] } },
    );

    expect(r.diagnostics).toEqual([]);
    expect(mm).toContain("[WDGWidget widgetWithLabel:");
    expect(mm).not.toContain("alloc] widgetWithLabel:");
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
    expect(mm).toMatch(
      /auto s0_ = \[.*coordinate\]; auto o0_ = std::make_shared<lucent_app::S_CLLocationCoordinate2D>\(\); o0_->latitude = static_cast<double>\(s0_\.latitude\); o0_->longitude = static_cast<double>\(s0_\.longitude\);/,
    );
    expect(mm).toContain("CLLocationCoordinate2DIsValid(CLLocationCoordinate2D{");
  });

  it("passes other modules' structs, enum fields and typedefs Swift names without a USR", () => {
    const { r, mm } = ios(mediaTimes);
    expect(r.diagnostics).toEqual([]);
    expect(mm).toContain("CMTimeMake(");
    // Fields take their own C types: an option set, and NSUInteger where Swift says Int.
    expect(mm).toContain("static_cast<decltype(CMTime::flags)>(");
    // NSUInteger fields are 64-bit integers: bigints, exactly or RangeError.
    // Each by the field's own C type: NSUInteger, where Swift says Int.
    expect(mm).toMatch(
      /lucent::toNativeInteger<decltype\(NSRange::length\)>\(\w+->length, "NSRange\.length"\)/,
    );
    expect(mm).toContain("lucent::BigInt{s0_.length}");
    expect(mm).toContain("NSUnionRange(NSRange{");
  });

  it("passes structs of modules the program does not import (CGRect, through UIKit)", () => {
    const { r, mm } = ios(unimportedStruct);
    expect(r.diagnostics).toEqual([]);
    expect(mm).toContain("initWithFrame:CGRect{CGPoint{");
  });

  it("passes opaque CoreFoundation handles (CGImage) as Lucent objects", () => {
    const { r, mm } = ios(cgImages);
    expect(r.diagnostics).toEqual([]);
    expect(mm).toContain("lucent::objc::wrapOpt((__bridge id)");
    expect(mm).toContain("initWithCGImage:(__bridge CGImageRef)lucent::objc::unwrap(");
    // Methods named create/copy/new return handles the caller owns (Cocoa's naming rule).
    expect(mm).toContain("lucent::objc::wrapOpt((__bridge_transfer id)[");
  });

  it("calls C functions Swift imports as members of CoreFoundation handles (cgImage.width)", () => {
    const { r, mm } = ios(cgMembers);

    expect(r.diagnostics).toEqual([]);
    expect(mm).toContain("CGImageGetWidth(");
    expect(mm).toContain("CGImageGetHeight(");
    // A Create function's result is owned: handed to ARC.
    expect(mm).toMatch(/__bridge_transfer [^;]*CGImageCreateWithImageInRect\(/);
  });

  it("passes type parameters' values as objects, read back as the type arguments say", () => {
    const { r, mm } = ios(caches);
    expect(r.diagnostics).toEqual([]);
    // Strings and numbers become NSString and NSNumber, and come back through the Any helpers.
    expect(mm).toContain("lucent::objc::asString(");
    expect(mm).toContain("lucent::objc::asNumber(");
    // Objects stay objects.
    expect(mm).toContain("objectForKey:");
  });

  it("gives Lucent functions blocks the platform passes, CoreFoundation values in blocks included", () => {
    const { r, mm } = ios(blockArgs);
    expect(r.diagnostics).toEqual([]);
    // The accessor's and the delegate method's completion handlers, as Lucent functions.
    expect(mm.match(/b_ = \(void \(\^\)\([^)]*\)\)a\d+_/g)?.length).toBe(2);
    // CFArrayRef and CFErrorRef in the block's signature, bridged to Lucent values.
    expect(mm).toContain("lucent::objc::block<void (^)(CFArrayRef, CFErrorRef)>");
    expect(mm).toContain("(CFArrayRef a0_, CFErrorRef a1_)");
  });

  it("passes numbers, enums, structs and objects through Out, read after the call", () => {
    const { r, mm } = ios(outParams);
    expect(r.diagnostics).toEqual([]);
    expect(mm).toContain("lucent::objc::NumberOut<CGFloat>(");
    expect(mm).toContain("lucent::objc::ObjectOut<NSDate*>(");
    expect(mm).toContain("lucent::objc::NumberOut<NSPropertyListFormat>(");
    expect(mm).toContain("lucent::objc::StructOut<NSRange>(");
    expect(mm).toContain("lucent::objc::outNumber(");
    expect(mm).toContain("lucent::objc::setOut(");
  });

  it("gives a block's pointer (BOOL *stop) to the Lucent function as an Out, written back", () => {
    const { r, mm } = ios(enumeration);
    expect(r.diagnostics).toEqual([]);
    expect(mm).toContain("(NSDate* a0_, BOOL a1_, BOOL* a2_)");
    expect(mm).toContain("lucent::objc::outOf(a2_)");
    expect(mm).toContain("lucent::objc::writeOut(");
  });

  it("passes NSSets as Lucent sets", () => {
    const { r, mm } = ios(sets);
    expect(r.diagnostics).toEqual([]);
    expect(mm).toContain("lucent::objc::fromNSSet<");
    expect(mm).toContain("touchesBegan:lucent::objc::toNSSet(");
  });

  it("reads UIView's frame, which a method of the same base name no longer hides", () => {
    const { r, mm } = ios(`import { UIView } from "lucent:ios/UIKit";
import { main } from "lucent:thread";
export async function run(): Promise<string> {
  return main(() => {
    const v = new UIView({ origin: { x: 0, y: 0 }, size: { width: 10, height: 20 } });
    const r = v.frameForAlignmentRect(v.frame);
    return \`\${v.frame.size.height} \${r.size.width}\`;
  });
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(mm).toContain(" frame]");
    expect(mm).toContain("frameForAlignmentRect:");
  });

  it("presents view controllers from the scene in use, and follows lifecycle events", () => {
    const { r, mm } = ios(presenting);
    expect(r.diagnostics).toEqual([]);
    expect(mm).toContain("#include <lucent/platform/ios_ui.h>");
    // present's type argument is the promise's: a value, nothing, a number.
    expect(mm).toContain("lucent::objc::present<bool>(");
    expect(mm).toContain("lucent::objc::present<void>(");
    expect(mm).toContain("lucent::objc::present<double>(");
    expect(mm).toContain("lucent::objc::onAppEvent(");
    expect(mm).toContain("lucent::objc::onSceneEvent(");
  });

  it("keeps main-thread APIs to present's function and lifecycle listeners", () => {
    const outside = ios(`import { UIViewController } from "lucent:ios/UIKit";
import { present } from "lucent:ios";
export async function run(): Promise<string> {
  const made = new UIViewController(null, null);
  await present<void>(() => made);
  return "";
}
`);
    expect(outside.r.diagnostics.map((d) => d.code)).toEqual(["LUCENT3006"]);

    const later = ios(`import { UIApplication } from "lucent:ios/UIKit";
import { onAppEvent } from "lucent:ios";
export async function run(): Promise<string> {
  const stop = onAppEvent("didBecomeActive", () => {
    // A function made there is not known to run on the main thread.
    const later = () => {
      UIApplication.shared.isIdleTimerDisabled = false;
    };
    later();
  });
  stop();
  return "";
}
`);
    expect(later.r.diagnostics.map((d) => d.code)).toEqual(["LUCENT3006"]);
  });

  it("takes present's function as a literal", () => {
    const named = ios(`import { UIViewController } from "lucent:ios/UIKit";
import { present } from "lucent:ios";
const build = (resolve: () => void) => new UIViewController(null, null);
export async function run(): Promise<string> {
  await present<void>(build);
  return "";
}
`);
    expect(named.r.diagnostics.map((d) => d.code)).toContain("LUCENT1007");
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

  // The compilers run in parallel and off the test's thread: one after another
  // they outlast the default timeout on CI, and block vitest's worker.
  it("generates Objective-C++ that compiles against the iOS SDK", async () => {
    const sdk = spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"], {
      encoding: "utf8",
    });
    if (process.platform !== "darwin" || sdk.status !== 0) return;
    const units = (
      [
        [clipboard],
        [files],
        [keychain],
        [callbacks],
        [promises],
        [delegate],
        [errorOut],
        [structs],
        [unimportedStruct],
        [cgImages],
        [cgMembers],
        [sets],
        [mediaTimes],
        [shadowing],
        [appleMacros],
        [pathMonitor],
        [presenting],
        [caches],
        [blockArgs],
        [outParams],
        [enumeration],
        [gauge, { ios: podsSearchPaths(pods) }],
      ] as [string, SdkOptions?][]
    ).map(([src, sdk]) => {
      const { r, dir } = ios(src, sdk);
      expect(r.diagnostics).toEqual([]);
      for (const [k, v] of r.files) {
        fs.mkdirSync(path.dirname(path.join(dir, "out", k)), { recursive: true });
        fs.writeFileSync(path.join(dir, "out", k), v);
      }
      return dir;
    });
    const stderrs = await Promise.all(
      units.map((dir) =>
        stderrOf("xcrun", [
          "--sdk",
          "iphonesimulator",
          "clang++",
          "-std=c++20",
          "-fobjc-arc",
          "-fsyntax-only",
          "-target",
          "arm64-apple-ios15.1-simulator",
          "-Werror",
          // Deprecated APIs are the program's choice (its declarations say @deprecated).
          "-Wno-deprecated-declarations",
          "-Wno-gnu-statement-expression",
          "-Wno-unused-label",
          "-Wno-parentheses-equality",
          "-Wno-comma",
          `-I${path.join(runtimeDir(), "cpp")}`,
          `-I${path.join(dir, "out/ios")}`,
          `-I${path.join(pods, "Pods/Headers/Public")}`,
          "-x",
          "objective-c++",
          path.join(dir, "out/ios/m_m.mm"),
        ]),
      ),
    );
    expect(stderrs).toEqual(units.map(() => ""));
  }, 600_000);
});

/** What a command writes to stderr, without blocking the test's thread. */
function stderrOf(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d: Buffer) => (err += d.toString()));
    child.on("error", reject);
    child.on("close", () => resolve(err));
  });
}

/** What the docs list as not bound yet: each is a diagnostic or a type error, never invalid C++. */
describe.skipIf(!sdkAvailable("ios"))("iOS bindings: documented limits", () => {
  it("keeps NSNumber an object: read it with its own members", () => {
    const wrong = ios(`import { UITouch } from "lucent:ios/UIKit";
import { main } from "lucent:thread";
export function run(): Promise<string> {
  return main(() => {
    const n: number | null = new UITouch().estimationUpdateIndex;
    return \`\${n}\`;
  });
}
`);
    expect(wrong.r.diagnostics.some((d) => d.message.includes("NSNumber"))).toBe(true);
    // Its members need Foundation imported (UIKit alone gives its name only).
    const right = ios(`import { UITouch } from "lucent:ios/UIKit";
import type { NSNumber } from "lucent:ios/Foundation";
import { main } from "lucent:thread";
export function run(): Promise<string> {
  return main(() => {
    const n: NSNumber | null = new UITouch().estimationUpdateIndex;
    return \`\${n?.doubleValue ?? -1}\`;
  });
}
`);
    expect(right.r.diagnostics.map((d) => d.message)).toEqual([]);
  });
});
