import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "@lucent-lang/bindgen";
import { androidJars } from "@lucent-lang/bindgen";
import { kotlinToolchain } from "../../bindgen/test/kotlin-toolchain.ts";
import { runtimeDir, type SdkOptions } from "../src/index.ts";
import { withSdkOptions } from "../src/sdk/schema.ts";
import { android, kotlinClasspath, ndkClang, ndkErrors } from "./android-harness.ts";
import { auditSdk } from "./dts-audit.ts";

const codes = (r: { diagnostics: { code: string }[] }) => r.diagnostics.map((d) => d.code);

const tracker = `import { Location, LocationListener, LocationManager } from "lucent:android/android.location";
import { appContext } from "lucent:android";
class Tracker implements LocationListener {
  fixes = 0;
  onLocationChanged(location: Location): void {
    this.fixes += location.getAccuracy() > 0 ? 1 : 0;
  }
  onProviderDisabled(provider: string): void {
    this.fixes = -1;
  }
}
export async function run(): Promise<string> {
  const tracker = new Tracker();
  const manager = appContext().getSystemService(LocationManager);
  manager?.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000n, 0, tracker);
  manager?.removeUpdates(tracker);
  return \`\${tracker.fixes}\`;
}
`;

const closeable = `import { MatrixCursor } from "lucent:android/android.database";
export async function run(): Promise<string> {
  let used: MatrixCursor | undefined;
  {
    using cursor = new MatrixCursor(["name"]);
    used = cursor;
  }
  const other = new MatrixCursor(["name"]);
  other[Symbol.dispose]();
  return \`\${used?.isClosed()} \${other.getCount()}\`;
}
`;

const watcher = `import { ConnectivityManager, ConnectivityManager_NetworkCallback, Network } from "lucent:android/android.net";
import { appContext } from "lucent:android";
class Watcher extends ConnectivityManager_NetworkCallback {
  events: string[] = [];
  constructor() {
    super();
  }
  onAvailable(network: Network): void {
    this.events.push(\`available \${network.toString()}\`);
  }
  onLost(network: Network): void {
    this.events.push("lost");
  }
}
export async function run(): Promise<string> {
  const manager = appContext().getSystemService(ConnectivityManager);
  const watcher = new Watcher();
  manager?.registerDefaultNetworkCallback(watcher);
  manager?.unregisterNetworkCallback(watcher);
  return watcher.events.join(",");
}
`;

const arrays = `import { Color } from "lucent:android/android.graphics";
import { File } from "lucent:android/java.io";
import { available } from "lucent:android";
export async function run(): Promise<string> {
  const files: File[] = new File("/").listFiles() ?? [];
  const names = files.map((f) => f.getName() ?? "").join(",");
  const color = Color.HSVToColor([120, 1, 1]);
  const parts = available("android", 26) ? Color.valueOf(color).getComponents() : null;
  return \`\${names} \${color} \${parts?.length}\`;
}
`;

// Java longs are bigints: arguments, results, long[] both ways, a proxy's
// long argument, and a constant beyond 2^53.
const longs = `import { Choreographer } from "lucent:android/android.view";
import { SystemClock } from "lucent:android/android.os";
import { Long } from "lucent:android/java.lang";
import { Arrays } from "lucent:android/java.util";
export async function run(): Promise<string> {
  const copied = Arrays.copyOf_longArray_int([1n, 2n ** 60n], 3);
  let frame = 0n;
  Choreographer.getInstance()?.postFrameCallback((t) => {
    frame = t;
  });
  SystemClock.sleep(1n);
  return \`\${copied?.join()} \${frame} \${SystemClock.elapsedRealtime() > 0n} \${Long.MAX_VALUE}\`;
}
`;

const listener = `import { Location, LocationManager } from "lucent:android/android.location";
import { Context } from "lucent:android/android.content";
import { appContext } from "lucent:android";
export async function run(): Promise<string> {
  const manager = appContext().getSystemService(LocationManager);
  let latest = "";
  const onLocation = (location: Location) => {
    latest = \`\${location.getLatitude()},\${location.getLongitude()}\`;
  };
  manager?.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000n, 0, onLocation);
  manager?.removeUpdates(onLocation);
  return \`\${latest} \${Context.LOCATION_SERVICE}\`;
}
`;

describe.skipIf(!sdkAvailable("android"))("Android bindings from android.jar", () => {
  it("calls an overload a subclass inherits beside the one it overrides", () => {
    const { r, cpp } = android(`import { ByteBuffer } from "lucent:android/java.nio";
export async function run(): Promise<string> {
  const buffer = ByteBuffer.allocate(8)!;
  buffer.limit(4);
  return \`\${buffer.limit()}\`;
}
`);

    expect(r.diagnostics).toEqual([]);

    // Buffer.limit() through the subclass: Java inherits the overload.
    expect(cpp).toContain('"limit", "()I"');
    expect(cpp).toContain('"(I)Ljava/nio/ByteBuffer;"');
  });

  it("passes CharSequence as strings", () => {
    const { r, cpp } = android(`import { ClipData } from "lucent:android/android.content";
export async function run(): Promise<string> {
  const clip = ClipData.newPlainText("label", "text");
  return clip?.getItemAt(0)?.getText() ?? "";
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(cpp).toContain(
      '"(Ljava/lang/CharSequence;Ljava/lang/CharSequence;)Landroid/content/ClipData;"',
    );
    expect(cpp).toContain("lucent::jni::charSequenceToString");
  });

  it("inlines compile-time constants", () => {
    const { r, cpp } = android(`import { Context } from "lucent:android/android.content";
export async function run(): Promise<string> {
  return Context.VIBRATOR_SERVICE;
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(cpp).toContain('"vibrator"');
    expect(cpp).not.toContain('"VIBRATOR_SERVICE"');
  });

  it("prefers int among overloads of numbers, and calls renamed overloads by their Java name", () => {
    const { r, cpp } = android(`import { Intent } from "lucent:android/android.content";
export async function run(): Promise<string> {
  new Intent().putExtra("a", 1).putExtra_string_long("b", 2n);
  return "";
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(cpp).toContain('"putExtra", "(Ljava/lang/String;I)Landroid/content/Intent;"');
    expect(cpp).toContain('"putExtra", "(Ljava/lang/String;J)Landroid/content/Intent;"');
  });

  it("copies byte[] as Uint8Array and String[] as string[]", () => {
    const { r, cpp } = android(`import { Build } from "lucent:android/android.os";
import { Base64 } from "lucent:android/android.util";
export async function run(): Promise<string> {
  const encoded = Base64.encodeToString(new Uint8Array([104, 105]), Base64.NO_WRAP) ?? "";
  const decoded = Base64.decode(encoded, Base64.NO_WRAP);
  return \`\${encoded} \${decoded?.length} \${(Build.SUPPORTED_ABIS ?? []).join(",")}\`;
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(cpp).toContain("lucent::jni::toByteArray");
    expect(cpp).toContain("lucent::jni::fromByteArray");
    expect(cpp).toContain("lucent::jni::fromStringArray");
  });

  it("copies Java arrays of numbers, booleans and objects, and arrays of arrays", () => {
    const { r, cpp } = android(arrays);

    expect(r.diagnostics).toEqual([]);
    expect(cpp).toContain("lucent::jni::toFloatArray");
    expect(cpp).toContain("lucent::jni::fromFloatArray");
    expect(cpp).toContain("lucent::jni::fromObjectArray");
    expect(cpp).toContain('"java/io/File"');
  });

  it("passes Java longs as bigints: long[] both ways, a proxy's long argument", () => {
    const { r, cpp } = android(longs);

    expect(r.diagnostics).toEqual([]);
    expect(cpp).toMatch(/lucent::jni::toLongArray\(.*"arg0 of Arrays\.copyOf_longArray_int"\)/);
    expect(cpp).toContain("lucent::jni::fromLongArray");
    expect(cpp).toContain("lucent::BigInt{lucent::jni::unboxLong(");
    expect(cpp).toContain("9223372036854775807");
  });

  it("reads instance fields", () => {
    const { r, cpp } = android(`import { appContext } from "lucent:android";
export async function run(): Promise<string> {
  const context = appContext();
  const info = context.getPackageManager()?.getPackageInfo(context.getPackageName() ?? "", 0);
  return \`\${info?.versionName ?? "?"} \${info?.firstInstallTime}\`;
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(cpp).toContain('"versionName", "Ljava/lang/String;"');
    expect(cpp).toContain("GetLongField");
  });

  it("types interfaces and calls them through the interface", () => {
    const { r, cpp } = android(`import { Uri } from "lucent:android/android.net";
import type { Parcelable } from "lucent:android/android.os";
export async function run(): Promise<string> {
  const p: Parcelable | null = Uri.parse("https://example.com");
  return \`\${p?.describeContents()}\`;
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(cpp).toContain('"android/os/Parcelable"');
    expect(cpp).toContain('"describeContents", "()I"');
  });

  it("requires a guard for APIs newer than the minimum SDK", () => {
    const unguarded = android(`import { VibrationEffect } from "lucent:android/android.os";
export async function run(): Promise<string> {
  VibrationEffect.createOneShot(10n, 10);
  return "";
}
`);
    expect(codes(unguarded.r)).toEqual(["LUCENT3007"]);
    expect(unguarded.r.diagnostics[0]!.message).toMatch(
      /VibrationEffect.*API 26.*available\("android", 26\)/,
    );

    const guarded =
      android(`import { Build_VERSION, VibrationEffect, Vibrator, VibratorManager } from "lucent:android/android.os";
import { appContext, available } from "lucent:android";
export async function run(): Promise<string> {
  const context = appContext();
  const v = available("android", 31) ? context.getSystemService(VibratorManager)?.defaultVibrator : context.getSystemService(Vibrator);
  if (Build_VERSION.SDK_INT >= 29) v?.vibrate(VibrationEffect.createPredefined(VibrationEffect.EFFECT_CLICK));
  if (!available("android", 26)) return "old";
  v?.vibrate(VibrationEffect.createOneShot(10n, VibrationEffect.DEFAULT_AMPLITUDE));
  return "";
}
`);
    expect(guarded.r.diagnostics).toEqual([]);
  });

  it("passes functions where Java takes an interface with one abstract method", () => {
    const { r, cpp } = android(listener);
    expect(r.diagnostics).toEqual([]);
    // One proxy per function, so removeUpdates gets the object requestLocationUpdates did.
    expect(cpp).toContain('lucent::jni::proxyFor(env, "android/location/LocationListener"');
    // Keyed by name and parameters: the default onLocationChanged(List) keeps its Java body.
    expect(cpp).toMatch(
      /\{"onLocationChanged\(Landroid\/location\/Location;\)", \[f_\]\(JNIEnv\* env, jobjectArray args_\) -> jobject \{/,
    );
    expect(cpp).toContain("lucent::postCallback(");
  });

  it("declares the permissions of the SDK methods it calls", () => {
    const { r } =
      android(`import { BiometricManager, BiometricManager_Authenticators as Authenticators } from "lucent:android/android.hardware.biometrics";
import { appContext, available } from "lucent:android";
export async function run(): Promise<string> {
  if (!available("android", 30)) return "";
  return \`\${appContext().getSystemService(BiometricManager)?.canAuthenticate(Authenticators.BIOMETRIC_WEAK)}\`;
}
`);
    expect(r.diagnostics).toEqual([]);
    expect(r.androidPermissions).toEqual(["android.permission.USE_BIOMETRIC"]);
  });

  it("names the Java classes the glue uses by name, for the app's shrinker to keep", () => {
    const { r } = android(tracker);
    expect(r.javaKeep).toEqual(
      expect.arrayContaining([
        "android/location/LocationListener",
        "android/location/LocationManager",
      ]),
    );
  });

  it("keeps the classes in the descriptors it looks up, which a shrinker would rename", () => {
    const { r } = android(
      `import { Task } from "lucent:android/com.google.android.gms.tasks";
let pending: Task<string> | null = null;
export async function run(): Promise<string> {
  return pending?.withToken(null).isSuccessful() ? "done" : "";
}
`,
      playServicesClasspath(),
    );
    expect(r.diagnostics).toEqual([]);
    // Passed as null, so never looked up itself: only in withToken's descriptor.
    expect(r.javaKeep).toContain("com/google/android/gms/tasks/CancellationToken");
  });

  it("implements Java interfaces with Lucent classes, one proxy per instance", () => {
    const { r, cpp } = android(tracker);
    expect(r.diagnostics).toEqual([]);
    expect(cpp).toContain(
      'lucent::jni::proxyFor(lucent::jni::env(), "android/location/LocationListener", o_.get(), {',
    );
    expect(cpp).toMatch(
      /\{"onLocationChanged\(Landroid\/location\/Location;\)", \[s_ = o_\]\(JNIEnv\* env, jobjectArray args_\) -> jobject \{/,
    );
    expect(cpp).toContain('{"onProviderDisabled(Ljava/lang/String;)", ');
  });

  it("extends abstract SDK classes with Lucent classes, through a generated Java subclass", () => {
    const { r, cpp } = android(watcher);
    expect(r.diagnostics).toEqual([]);
    const java = r.java?.get("dev/lucent/generated/Watcher.java") ?? "";
    expect(java).toContain(
      "public final class Watcher extends android.net.ConnectivityManager.NetworkCallback {",
    );
    expect(java).toContain("  public void onAvailable(android.net.Network a0) {");
    expect(java).toContain(
      '    NativeProxy.dispatch(handle, "onAvailable(Landroid/net/Network;)", new Object[] {a0});',
    );
    // Methods the Lucent class leaves out keep the SDK's body.
    expect(java).not.toContain("onUnavailable");
    expect(cpp).toContain(
      'lucent::jni::subclassFor(lucent::jni::env(), "dev/lucent/generated/Watcher", o_.get(), {',
    );
    const jar = androidJars()?.[0];
    if (!jar || spawnSync("javac", ["-version"]).status !== 0) return;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-java-"));
    fs.mkdirSync(path.join(dir, "src/dev/lucent/generated"), { recursive: true });
    fs.writeFileSync(path.join(dir, "src/dev/lucent/generated/Watcher.java"), java);
    const cc = spawnSync(
      "javac",
      [
        "--release",
        "11",
        "-Xlint:-options",
        "-cp",
        jar,
        "-d",
        path.join(dir, "out"),
        path.join(runtimeDir(), "native/android/src/main/java/dev/lucent/NativeProxy.java"),
        path.join(dir, "src/dev/lucent/generated/Watcher.java"),
      ],
      { encoding: "utf8" },
    );
    expect(cc.stderr).toBe("");
  });

  it("ships a NativeProxy that compiles against android.jar", () => {
    const jar = androidJars()?.[0];
    if (!jar || spawnSync("javac", ["-version"]).status !== 0) return;
    const out = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-java-"));
    const cc = spawnSync(
      "javac",
      [
        "--release",
        "11",
        "-Xlint:-options",
        "-cp",
        jar,
        "-d",
        out,
        path.join(runtimeDir(), "native/android/src/main/java/dev/lucent/NativeProxy.java"),
      ],
      { encoding: "utf8" },
    );
    expect(cc.stderr).toBe("");
  });

  it("generates JNI C++ that compiles with the NDK", () => {
    const bin = ndkClang();
    if (!bin) return;
    const calls = `import { ClipData, Context, Intent } from "lucent:android/android.content";
import { Uri } from "lucent:android/android.net";
import { Build, Vibrator } from "lucent:android/android.os";
import { Base64 } from "lucent:android/android.util";
import { appContext } from "lucent:android";
export async function run(): Promise<string> {
  const context = appContext();
  const info = context.getPackageManager()?.getPackageInfo(context.getPackageName() ?? "", 0);
  new Intent().putExtra("a", 1).putExtra_string_long("b", 2n);
  const bytes = Base64.decode(Base64.encodeToString(new Uint8Array([1, 2]), Base64.NO_WRAP) ?? "", 0);
  // Optional calls of void methods are values too.
  appContext().getSystemService(Vibrator)?.cancel();
  // A native value whose type is not nullable, compared with null.
  if (appContext() === null) return "";
  // The checker narrows Build.MODEL here; the glue still returns string | null.
  if (Build.MODEL) return Build.MODEL;
  return \`\${ClipData.newPlainText("l", "t")?.getItemAt(0)?.getText()} \${Context.VIBRATOR_SERVICE} \${info?.versionName} \${bytes?.length} \${Uri.parse("x")?.describeContents()} \${(Build.SUPPORTED_ABIS ?? []).join()}\`;
}
`;
    // Lucent names the JNI glue uses (env), that look like its temporaries,
    // or that are reserved words (id, self), passed to calls whose glue has
    // temporaries of that spelling (id_).
    const shadowing = `import { Intent } from "lucent:android/android.content";
import { Build } from "lucent:android/android.os";
export async function run(): Promise<string> {
  const env = "x";
  const id = 3;
  const self = "s";
  const cls_ = 4;
  const r_ = Build.MODEL ?? env;
  new Intent().putExtra(self, id).putExtra("c", cls_);
  return r_;
}
`;
    const units: [string, SdkOptions?][] = [
      [calls],
      [arrays],
      [listener],
      [tracker],
      [watcher],
      [shadowing],
      [generics],
      [closeable],
      [longs],
      [adapters, playServicesClasspath()],
    ];
    for (const [src, sdk] of units) {
      const { r, dir } = android(src, sdk);
      expect(r.diagnostics).toEqual([]);
      expect(ndkErrors(bin, r.files, dir)).toBe("");
    }
    // About 10 s alone; several clang runs, so minutes when the machine is busy.
  }, 180_000);
});

/**
 * An app's Gradle classpath holding Play services' Task (the bindgen
 * fixture's subset of it), as .lucent/android-classpath.json lists it.
 */
function playServicesClasspath(rename: (text: string) => string = (text) => text): SdkOptions {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-classpath-"));
  const java = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../bindgen/test/fixtures/java",
  );
  const sources = [
    "com/google/android/gms/tasks/Task.java",
    "com/google/android/gms/tasks/OnCompleteListener.java",
    "com/google/android/gms/tasks/CancellationToken.java",
    "com/google/common/util/concurrent/ListenableFuture.java",
  ].map((f) => {
    const target = path.join(dir, "src", rename(f));

    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, rename(fs.readFileSync(path.join(java, f), "utf8")));
    return target;
  });

  const classes = path.join(dir, "classes");
  const cc = spawnSync(
    "javac",
    [
      "--release",
      "11",
      "-d",
      classes,
      ...sources,
      path.join(java, "android/annotation/NonNull.java"),
    ],
    { encoding: "utf8" },
  );
  if (cc.status !== 0) throw new Error(cc.stderr);

  const jar = path.join(dir, "play-services-tasks.jar");
  const packages = fs.readdirSync(classes).filter((d) => d !== "android");
  spawnSync("jar", ["cf", jar, ...packages.flatMap((d) => ["-C", classes, d])]);

  const classpath = path.join(dir, "android-classpath.json");
  fs.writeFileSync(classpath, JSON.stringify({ jars: [jar] }));
  return { android: { classpath } };
}

/**
 * What `await` on a Task, a ListenableFuture or a CompletionStage did before
 * Lucent stopped recognizing them by name, written as adapters: the result
 * (null when there is none, and for a null task), or the exception as the
 * error a thrown one becomes, unwrapped from Execution/CompletionException.
 */
const adapters = `import { error, errorCode, fromCallback } from "lucent:core";
import type { Runnable, Throwable } from "lucent:android/java.lang";
import {
  CompletableFuture,
  CompletionException,
  type CompletionStage,
} from "lucent:android/java.util.concurrent";
import type { Task } from "lucent:android/com.google.android.gms.tasks";
import type { ListenableFuture } from "lucent:android/com.google.common.util.concurrent";

/**
 * The error a thrown exception becomes, from what Throwable.toString gives
 * ("class: message", or the class alone): the class is the code, and the
 * message falls back to it. A class overriding toString would break this.
 */
function fromText(text: string): Error {
  const colon = text.indexOf(": ");
  const code = colon < 0 ? text : text.slice(0, colon);

  return error(code, colon < 0 ? code : text.slice(colon + 2));
}

const javaError = (failure: Throwable): Error => fromText(failure.toString());

function completed(task: Task<string> | null): Promise<string | null> {
  return fromCallback<string | null>((resolve, reject) => {
    if (!task) return resolve(null);

    task.addOnCompleteListener((done) => {
      if (done.isSuccessful()) return resolve(done.getResult());

      // A cancelled task has no exception.
      const failure = done.getException();
      reject(failure ? javaError(failure) : error("java.util.concurrent.CancellationException", "cancelled"));
    });
  });
}

function settled(stage: CompletionStage<string> | null): Promise<string | null> {
  return fromCallback<string | null>((resolve, reject) => {
    if (!stage) return resolve(null);

    stage.whenComplete((value: string | null, failure: Throwable | null) => {
      if (!failure) return resolve(value);

      const cause = failure instanceof CompletionException ? failure.getCause() : null;
      reject(javaError(cause ?? failure));
    });
  });
}

function done(future: ListenableFuture<string> | null): Promise<string | null> {
  return fromCallback<string | null>((resolve, reject) => {
    if (!future) return resolve(null);

    // The executor runs the listener at once; both are Java callbacks
    // returning void, so each is queued to the Lucent thread.
    future.addListener(
      () => {
        try {
          resolve(future.get());
        } catch (e) {
          // ExecutionException(cause) says the cause's toString as its message.
          const wrapped = errorCode(e as Error) === "java.util.concurrent.ExecutionException";
          reject(wrapped ? fromText((e as Error).message) : (e as Error));
        }
      },
      (command: Runnable | null) => command?.run(),
    );
  });
}

let pending: Task<string> | null = null;
let later: ListenableFuture<string> | null = null;

export async function run(): Promise<string> {
  const text = await settled(CompletableFuture.completedFuture("done"));
  return \`\${text ?? ""} \${await completed(pending)} \${await done(later)}\`;
}
`;

/** Awaiting each native object `await` used to settle, and one it never knew. */
const awaited = (
  type: string,
  from: string,
  args = "<string>",
) => `import type { ${type} } from "lucent:android/${from}";
let pending: ${type}${args} | null = null;
export async function run(): Promise<string> {
  const value = await pending;
  return \`\${value}\`;
}
`;

const generics = `import { Location, LocationManager } from "lucent:android/android.location";
import { appContext, available } from "lucent:android";
export async function run(): Promise<string> {
  const manager = appContext().getSystemService(LocationManager);
  const providers = manager?.getAllProviders();
  const first: string | null = providers?.get(0) ?? null;
  let fix = "";
  const executor = available("android", 28) ? appContext().getMainExecutor() : null;
  if (executor && available("android", 30))
    manager?.getCurrentLocation(
      LocationManager.GPS_PROVIDER,
      null,
      executor,
      (location: Location | null) => {
        fix = \`\${location?.getLatitude()}\`;
      },
    );
  return \`\${providers?.size()} \${first} \${fix}\`;
}
`;

describe.skipIf(!sdkAvailable("android"))("Android generic classes", () => {
  it("types members that use a class's type parameters, as the type arguments say", () => {
    const { r, cpp } = android(generics);
    expect(r.diagnostics).toEqual([]);
    // List<String>.get: erased to Object, read as the string the type argument says.
    expect(cpp).toContain('"get", "(I)Ljava/lang/Object;"');
    expect(cpp).toMatch(/fromJStringOpt\(env, static_cast<jstring>\(r_\)\)/);
    // Consumer<Location>: a function implements it, and receives a Location.
    expect(cpp).toContain('"accept(Ljava/lang/Object;)"');
  });
});

describe.skipIf(!sdkAvailable("android"))("await on a native object", () => {
  it("is refused, whatever the class, with fromCallback as the way to wait for it", () => {
    const sources = [
      awaited("Task", "com.google.android.gms.tasks"),
      awaited("ListenableFuture", "com.google.common.util.concurrent"),
      awaited("CompletableFuture", "java.util.concurrent"),
      awaited("MatrixCursor", "android.database", ""),
    ];

    for (const source of sources) {
      const { r } = android(source, playServicesClasspath());

      expect(codes(r), source).toEqual(["LUCENT1010"]);
      expect(r.diagnostics[0]!.message).toContain("fromCallback");
    }
  });

  it("waits through the adapters a package writes with fromCallback", () => {
    const { r, cpp } = android(adapters, playServicesClasspath());

    expect(r.diagnostics).toEqual([]);
    expect(cpp).toContain("lucent::fromCallback");
    // Each listener is the extracted interface, implemented by a function.
    expect(cpp).toContain('"onComplete(Lcom/google/android/gms/tasks/Task;)"');
    expect(cpp).toContain('"accept(Ljava/lang/Object;Ljava/lang/Object;)"');
    expect(cpp).toContain('"execute(Ljava/lang/Runnable;)"');
  });

  it("treats a Task under names no table knows exactly as it treats Play services'", () => {
    const tag = `Q${crypto
      .randomBytes(3)
      .toString("hex")
      .replace(/\d/g, (d) => "ABCDEFGHIJ"[+d]!)}`;
    const rename = (text: string) =>
      text
        .replaceAll("com.google.android.gms.tasks", `dev.${tag.toLowerCase()}.jobs`)
        .replaceAll("com/google/android/gms/tasks", `dev/${tag.toLowerCase()}/jobs`)
        .replaceAll("addOnCompleteListener", `when${tag}Done`)
        .replaceAll("OnCompleteListener", `${tag}Callback`)
        .replaceAll("onComplete", `on${tag}`)
        .replaceAll("Task", `${tag}Job`);
    const sdk = playServicesClasspath(rename);

    const refused = android(rename(awaited("Task", "com.google.android.gms.tasks")), sdk);
    expect(codes(refused.r)).toEqual(["LUCENT1010"]);

    const adapted = android(rename(adapters), sdk);
    expect(adapted.r.diagnostics).toEqual([]);
    expect(adapted.cpp).toContain(`"on${tag}(Ldev/${tag.toLowerCase()}/jobs/${tag}Job;)"`);
  });
});

describe("awaitable classes", () => {
  it("are listed nowhere in Lucent: not in bindgen, the compiler or the runtime", () => {
    const packages = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
    const roots = ["bindgen/src", "compiler/src", "compiler/lib", "runtime/cpp", "runtime/native"];
    const names = /gms[./]tasks|ListenableFuture|CompletionStage|CompletableFuture|AWAITABLE/;
    // LUCENT1010's explanation names them, to show the migration.
    const prose = path.join("compiler", "src", "codes.ts");

    const named = roots.flatMap((root) =>
      fs
        .readdirSync(path.join(packages, root), { recursive: true, encoding: "utf8" })
        .filter((f) => !/(^|\/)(build|\.cxx|\.gradle)\//.test(f))
        .map((f) => path.join(packages, root, f))
        .filter((f) => fs.statSync(f).isFile() && names.test(fs.readFileSync(f, "utf8")))
        .map((f) => path.relative(packages, f))
        .filter((f) => f !== prose),
    );

    expect(named).toEqual([]);
  });
});

describe.skipIf(!sdkAvailable("android"))("using on AutoCloseable", () => {
  it("closes an AutoCloseable however its block is left, and on [Symbol.dispose]()", () => {
    const { r, cpp } = android(closeable);
    expect(r.diagnostics).toEqual([]);
    // Once for the using declaration, once for the explicit call.
    expect(cpp.match(/lucent::jni::close\(/g)).toHaveLength(2);
    expect(cpp).toContain("lucent::suppressedError");
  });
});

describe.skipIf(!sdkAvailable("android"))("Android thread annotations", () => {
  it("makes @UiThread classes and @MainThread methods main-only", () => {
    const outside = android(`import { View } from "lucent:android/android.view";
import { appContext } from "lucent:android";
export async function run(): Promise<string> {
  return \`\${new View(appContext()).getWidth()}\`;
}
`);
    expect(codes(outside.r)).toContain("LUCENT3006");
    const inside = android(`import { View } from "lucent:android/android.view";
import { appContext } from "lucent:android";
import { main } from "lucent:thread";
export async function run(): Promise<string> {
  return main(() => \`\${new View(appContext()).getWidth()}\`);
}
`);
    expect(inside.r.diagnostics).toEqual([]);
  });

  it("warns when a @WorkerThread method runs in a main context", () => {
    const onMain = android(`import { BlockedNumberContract } from "lucent:android/android.provider";
import { appContext } from "lucent:android";
import { main } from "lucent:thread";
export async function run(): Promise<string> {
  return main(() => \`\${BlockedNumberContract.isBlocked(appContext(), "1")}\`);
}
`);
    expect(onMain.r.diagnostics).toEqual([]);
    expect(onMain.r.warnings?.map((w) => w.code)).toEqual(["LUCENT3009"]);
    const off = android(`import { BlockedNumberContract } from "lucent:android/android.provider";
import { appContext } from "lucent:android";
export async function run(): Promise<string> {
  return \`\${BlockedNumberContract.isBlocked(appContext(), "1")}\`;
}
`);
    expect(off.r.warnings ?? []).toEqual([]);
  });
});

describe.skipIf(!sdkAvailable("android"))("Android constant groups", () => {
  it("warns when an argument is a constant outside its @IntDef or @StringDef group", () => {
    const ok = android(`import { Toast } from "lucent:android/android.widget";
import { NetworkCapabilities } from "lucent:android/android.net";
import { appContext } from "lucent:android";
// Any number still goes: the group is checked where the value is known.
function has(caps: NetworkCapabilities, transport: number): boolean {
  return caps.hasTransport(transport);
}
export async function run(): Promise<string> {
  const toast = Toast.makeText(appContext(), "hi", Toast.LENGTH_SHORT);
  return \`\${toast !== null}\`;
}
`);
    expect(ok.r.diagnostics).toEqual([]);
    expect(ok.r.warnings ?? []).toEqual([]);
    const wrong = android(`import { Toast } from "lucent:android/android.widget";
import { KeyGenParameterSpec_Builder, KeyProperties } from "lucent:android/android.security.keystore";
import { appContext } from "lucent:android";
export async function run(): Promise<string> {
  const toast = Toast.makeText(appContext(), "hi", 5);
  const spec = new KeyGenParameterSpec_Builder("k", KeyProperties.PURPOSE_ENCRYPT)
    .setBlockModes([KeyProperties.BLOCK_MODE_GCM, "XTS"])
    ?.build();
  return \`\${toast !== null} \${spec !== null}\`;
}
`);
    // Warnings: the code compiles, as javac and lint let it.
    expect(wrong.r.diagnostics).toEqual([]);
    expect(wrong.r.warnings!.map((w) => [w.code, w.severity, w.line])).toEqual([
      ["LUCENT3008", "warning", 5],
      ["LUCENT3008", "warning", 7],
    ]);
    expect(wrong.r.warnings![0]!.message).toContain("Toast.LENGTH_SHORT, Toast.LENGTH_LONG");
  });

  it("gives an @IntDef result as the union of its constants", () => {
    // A View is main-only (@UiThread).
    const { r } = android(`import { View } from "lucent:android/android.view";
import { appContext } from "lucent:android";
import { main } from "lucent:thread";
export async function run(): Promise<string> {
  const visibility: 0 | 4 | 8 = await main(() => new View(appContext()).getVisibility());
  return \`\${visibility === View.VISIBLE}\`;
}
`);
    expect(r.diagnostics).toEqual([]);
  });
});

/** What the docs list as not bound yet: each is a diagnostic, never a crash or invalid C++. */
describe.skipIf(!sdkAvailable("android"))("Android bindings: documented limits", () => {
  it("rejects writing Java fields", () => {
    const { r } = android(`import { Rect } from "lucent:android/android.graphics";
export async function run(): Promise<string> {
  const rect = new Rect();
  rect.left = 1;
  return "";
}
`);
    expect(codes(r)).toContain("LUCENT1008");
  });

  it("rejects a method of an SDK object used as a value", () => {
    const { r } = android(`import { Rect } from "lucent:android/android.graphics";
export async function run(): Promise<string> {
  const width = new Rect().width;
  return \`\${width()}\`;
}
`);
    expect(codes(r)).toContain("LUCENT1001");
  });
});

const kotlin = kotlinToolchain();

describe.skipIf(!sdkAvailable("android") || !kotlin)(
  "Android bindings from Kotlin libraries",
  () => {
    let sdk: SdkOptions;

    beforeAll(async () => {
      sdk = await kotlinClasspath(kotlin!);
    }, 300_000);

    const orbit = `import { ExtensionsKt, SearchClient, SearchHit } from "lucent:android/dev.orbit.search";
export async function run(): Promise<string> {
  const hit = new SearchHit("title", 1);
  const client = new SearchClient("https://orbit.invalid", null);
  client.configure(2, "twice");
  return \`\${ExtensionsKt.toQuery("query", 3)} \${ExtensionsKt.getShortTitle(hit)} \${ExtensionsKt.VERSION} \${client.pageSize} \${client.endpoint}\`;
}
`;

    it("calls extensions receiver-first and reads Kotlin properties through their getters", () => {
      const { r } = android(orbit, sdk);
      const cpp = r.files.get("android/m_m.cpp") ?? "";

      expect(r.diagnostics).toEqual([]);
      expect(cpp).toContain('"toQuery", "(Ljava/lang/String;I)Ljava/lang/String;"');
      expect(cpp).toContain('"getShortTitle", "(Ldev/orbit/search/SearchHit;)Ljava/lang/String;"');
      expect(cpp).toContain('"getVERSION", "()Ljava/lang/String;"');
      expect(cpp).toContain('"getPageSize", "()I"');
      expect(cpp).toContain('"configure", "(ILjava/lang/String;)V"');
    });

    it.skipIf(!ndkClang())(
      "generates JNI C++ for Kotlin libraries that compiles with the NDK",
      () => {
        const { r, dir } = android(orbit, sdk);

        expect(r.diagnostics).toEqual([]);
        expect(ndkErrors(ndkClang()!, r.files, dir)).toBe("");
      },
      180_000,
    );

    it("declares the library without errors, checked without skipLibCheck", () => {
      const audit = withSdkOptions(sdk, () => auditSdk("android", ["dev.orbit.search"]));

      expect(audit.errors.filter((e) => e.module.startsWith("dev.orbit"))).toEqual([]);
    });
  },
);

describe.skipIf(!sdkAvailable("android") || !ndkClang())("awaiting operands of SDK calls", () => {
  // The glue runs in C++ lambdas, where the calling coroutine cannot suspend.
  const awaited = `import { File } from "lucent:android/java.io";
import { Point } from "lucent:android/android.graphics";
import { Uri } from "lucent:android/android.net";
async function file(): Promise<File> {
  return new File("/tmp", "a");
}
async function point(): Promise<Point> {
  return new Point(1, 2);
}
async function text(s: string): Promise<string> {
  return s;
}
export async function run(): Promise<string> {
  const name = (await file()).getName();
  const x = (await point()).x;
  const uri = Uri.parse(await text("x"));
  const order = new File(await text("/tmp")).compareTo(await file());
  const made = new File(await text("/tmp"), "b").getPath();
  return \`\${name} \${x} \${uri} \${order} \${made}\`;
}
`;

  it("evaluates receivers and arguments that await before the call", () => {
    const { r, dir } = android(awaited);

    expect(r.diagnostics).toEqual([]);
    expect(ndkErrors(ndkClang()!, r.files, dir)).toBe("");
  }, 180_000);
});
