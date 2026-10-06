// Where an SDK declaration comes from natively, and how Lucent maps it
// (T61): the line each class and member's doc gains, so an editor's hover
// and go-to-definition say what it calls.
import { describe, expect, it } from "vite-plus/test";
import { sdkDts } from "../src/sdk/dts.ts";
import { classOrigin, memberOrigin } from "../src/sdk/native-origin.ts";
import { parseSdkType, type SdkClassSchema, type SdkModuleSchema } from "../src/sdk/schema.ts";

const T = (s: string, module = "UIKit") => parseSdkType(s, module);

const ios = (types: SdkClassSchema[], artifact = "sdk:iphonesimulator27.0"): SdkModuleSchema => ({
  format: 1,
  platform: "ios",
  module: "UIKit",
  provenance: {
    artifact,
    kind: artifact.startsWith("pod:") ? "framework" : "sdk",
    target: "arm64-apple-ios15.1-simulator",
    extractor: "test",
  },
  types,
});

const device: SdkClassSchema = {
  kind: "class",
  name: "UIDevice",
  native: "UIDevice",
  constructors: [
    { params: [], selector: "init" },
    { params: [], selector: "currentDevice", factory: true },
  ],
  methods: [
    {
      name: "endGenerating",
      selector: "endGeneratingDeviceOrientationNotifications",
      params: [],
      returns: T("void"),
    },
    {
      name: "named",
      selector: "deviceNamed:",
      static: true,
      params: [{ name: "n", type: T("string") }],
      returns: T("UIKit.UIDevice"),
    },
    {
      name: "load",
      selector: "loadWithReply:",
      params: [{ name: "reply", type: T("(error?) => void") }],
      returns: T("void"),
      async: { returns: T("void"), throws: true },
    },
  ],
  properties: [
    { name: "batteryLevel", type: T("float"), readonly: true },
    { name: "hidden", type: T("bool"), selector: "isHidden", setter: "setHidden:" },
  ],
};

describe("a declaration's native origin", () => {
  it("names Objective-C classes, methods, properties and initializers, in their module", () => {
    const schema = ios([device]);
    const m = (name: string) => device.methods!.find((x) => x.name === name)!;
    const p = (name: string) => device.properties!.find((x) => x.name === name)!;

    expect(classOrigin(schema, device)).toBe("Native: Objective-C class UIDevice, in UIKit");
    expect(memberOrigin(schema, device, { method: m("endGenerating") })).toBe(
      "Native: -[UIDevice endGeneratingDeviceOrientationNotifications], in UIKit",
    );
    expect(memberOrigin(schema, device, { method: m("named") })).toBe(
      "Native: +[UIDevice deviceNamed:], in UIKit",
    );
    expect(memberOrigin(schema, device, { property: p("batteryLevel") })).toBe(
      "Native: -[UIDevice batteryLevel], in UIKit",
    );
    expect(memberOrigin(schema, device, { property: p("hidden") })).toBe(
      "Native: -[UIDevice isHidden] and -[UIDevice setHidden:], in UIKit",
    );
    expect(memberOrigin(schema, device, { initializer: device.constructors![0]! })).toBe(
      "Native: -[UIDevice init], in UIKit",
    );
    expect(memberOrigin(schema, device, { initializer: device.constructors![1]! })).toBe(
      "Native: +[UIDevice currentDevice], in UIKit",
    );
  });

  it("says how a mapping differs from the native declaration", () => {
    const m = device.methods!.find((x) => x.name === "load")!;

    expect(memberOrigin(ios([device]), device, { method: m, promise: true })).toBe(
      "Native: -[UIDevice loadWithReply:], in UIKit; without its completion handler, a Promise it settles",
    );
  });

  it("gives a completion-handler method's two forms each its own line", () => {
    const m = device.methods!.find((x) => x.name === "load")!;
    const d = sdkDts(ios([device]));

    // The handler form calls the Objective-C method as is.
    expect(memberOrigin(ios([device]), device, { method: m })).toBe(
      "Native: -[UIDevice loadWithReply:], in UIKit",
    );
    expect(d).toContain(
      "   * Native: -[UIDevice loadWithReply:], in UIKit.\n   */\n  load(reply: (",
    );
    expect(d).toContain(
      "   * Native: -[UIDevice loadWithReply:], in UIKit; without its completion handler, a Promise it settles.\n   */\n  load(): Promise<void>;",
    );
  });

  it("names Swift members and C functions by how Swift and C name them", () => {
    const point: SdkClassSchema = {
      kind: "class",
      name: "Point",
      native: "Geometry.Point",
      swift: { kind: "struct" },
      methods: [
        { name: "distance", params: [], returns: T("double"), swift: { name: "distance(to:)" } },
      ],
    };
    const image: SdkClassSchema = {
      kind: "class",
      name: "CGImage",
      native: "CGImageRef",
      cf: true,
      properties: [
        {
          name: "width",
          type: T("long"),
          readonly: true,
          cFunctions: { getter: "CGImageGetWidth" },
        },
      ],
    };
    const schema = ios([point, image]);

    expect(classOrigin(schema, point)).toBe("Native: Swift struct Geometry.Point, in UIKit");
    expect(memberOrigin(schema, point, { method: point.methods![0]! })).toBe(
      "Native: Swift Geometry.Point.distance(to:), in UIKit",
    );
    expect(classOrigin(schema, image)).toBe("Native: C type CGImageRef, in UIKit");
    expect(memberOrigin(schema, image, { property: image.properties![0]! })).toBe(
      "Native: CGImageGetWidth(), in UIKit",
    );
  });

  it("names a JVM class's members with their descriptors", () => {
    const vibrator: SdkClassSchema = {
      kind: "class",
      name: "Vibrator",
      native: "android/os/Vibrator",
      constructors: [{ params: [], descriptor: "()V" }],
      methods: [
        {
          name: "vibrate",
          params: [{ name: "ms", type: T("long", "android.os") }],
          returns: T("void", "android.os"),
          descriptor: "(J)V",
        },
      ],
      properties: [
        { name: "name", type: T("string", "android.os"), readonly: true, getter: "getName" },
      ],
    };
    const schema: SdkModuleSchema = {
      format: 1,
      platform: "android",
      module: "android.os",
      provenance: {
        artifact: "android-sdk:36",
        kind: "jar",
        target: "android-36",
        extractor: "test",
      },
      types: [vibrator],
    };

    expect(classOrigin(schema, vibrator)).toBe(
      "Native: Java class android.os.Vibrator, in android.os",
    );
    expect(memberOrigin(schema, vibrator, { method: vibrator.methods![0]! })).toBe(
      "Native: android.os.Vibrator#vibrate(J)V, in android.os",
    );
    expect(memberOrigin(schema, vibrator, { initializer: vibrator.constructors![0]! })).toBe(
      "Native: android.os.Vibrator#<init>()V, in android.os",
    );
    expect(memberOrigin(schema, vibrator, { property: vibrator.properties![0]! })).toBe(
      "Native: android.os.Vibrator#getName(), in android.os; read through its getter",
    );
  });

  it("names a Kotlin suspend function as Kotlin does, not by its Continuation", () => {
    const searcher: SdkClassSchema = {
      kind: "class",
      name: "Searcher",
      native: "dev/orbit/Searcher",
      kotlin: { kind: "class" },
      methods: [
        {
          name: "search",
          params: [{ name: "q", type: T("string", "dev.orbit") }],
          returns: T("int", "dev.orbit"),
          descriptor: "(Ljava/lang/String;Lkotlin/coroutines/Continuation;)Ljava/lang/Object;",
          kotlin: { suspend: true },
        },
      ],
    };
    const schema: SdkModuleSchema = {
      format: 1,
      platform: "android",
      module: "dev.orbit",
      types: [searcher],
    };

    expect(memberOrigin(schema, searcher, { method: searcher.methods![0]! })).toBe(
      "Native: Kotlin suspend fun dev.orbit.Searcher.search, in dev.orbit; a Promise of what it completes with",
    );
  });

  it("names the artifact a declaration comes from when it is no platform SDK", () => {
    expect(classOrigin(ios([device], "pod:OrbitKit@1.2.0"), device)).toBe(
      "Native: Objective-C class UIDevice, in UIKit (pod:OrbitKit@1.2.0)",
    );
  });

  it("puts the line before a deprecated member's tag, which would take it as its message", () => {
    const old: SdkClassSchema = {
      ...device,
      methods: [{ ...device.methods![0]!, deprecated: true, since: "3.0" }],
    };

    expect(sdkDts(ios([old]))).toContain(
      "   * Since iOS 3.0.\n   * Native: -[UIDevice endGeneratingDeviceOrientationNotifications], in UIKit.\n   * @deprecated\n",
    );
  });

  it("puts the line in the declarations' doc comments, where an editor shows it", () => {
    const d = sdkDts(ios([device]));

    expect(d).toContain("Native: Objective-C class UIDevice, in UIKit");
    expect(d).toContain("Native: -[UIDevice isHidden] and -[UIDevice setHidden:], in UIKit");
    expect(d).toContain("Native: +[UIDevice deviceNamed:], in UIKit");
  });
});
