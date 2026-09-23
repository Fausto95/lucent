/**
 * The binding schema format: what a platform SDK module contains, as data.
 * Extractors (android.ts, ios.ts) produce it; the compiler types
 * `lucent:ios/<module>` and `lucent:android/<package>` imports from it and
 * lowers calls to glue.
 */

export type Platform = "ios" | "android";
export const PLATFORMS: readonly Platform[] = ["ios", "android"];

export interface SdkModuleSchema {
  platform: Platform;
  /** Clang/Swift module (iOS) or Java package (Android). */
  module: string;
  /** Frameworks to link (iOS): the SDK framework; none for a pod, which links itself. */
  frameworks?: string[];
  /** The header to import for the module (iOS): `M/M.h`, or the umbrella its module map names. */
  header?: string;
  types: (SdkClassSchema | SdkEnumSchema)[];
  /** C functions (iOS). */
  functions?: SdkMethodSchema[];
  /** C global constants (iOS): `kSecClass`, `NSFileCreationDate`… */
  constants?: SdkPropertySchema[];
  /** Members an extractor could not type yet (`Class.member: reason`). */
  skipped?: string[];
}

export interface SdkEnumSchema {
  kind: "enum";
  /** Name in Lucent: Swift name, nested types joined with `_`. */
  name: string;
  /** The C enum type. */
  native: string;
  cases: { name: string; native: string; value: number }[];
}

export interface SdkParam {
  name: string;
  type: string;
}

export interface SdkCallable {
  params: SdkParam[];
  /** Objective-C selector (iOS). */
  selector?: string;
  /** API level (Android) or OS version (iOS) that introduced it. */
  since?: number | string;
  /** Exact JNI descriptor (Android), when the types alone do not give it (generic erasure). */
  descriptor?: string;
  deprecated?: boolean;
}

export interface SdkMethodSchema extends SdkCallable {
  name: string;
  returns: string;
  static?: boolean;
  typeParams?: string[];
  mainActor?: boolean;
  /** The Java method name, when `name` was changed to tell overloads apart. */
  java?: string;
  /** Reports failure through a trailing NSError** (Swift `throws`). */
  throws?: boolean;
}

export interface SdkPropertySchema {
  name: string;
  type: string;
  static?: boolean;
  readonly?: boolean;
  /** Objective-C getter selector, when it differs from `name` (iOS). */
  selector?: string;
  /** Objective-C setter selector, for writable properties (iOS). */
  setter?: string;
  /** Getter method, for Kotlin-style properties (Android); fields otherwise. */
  getter?: string;
  /** A C global holding the value (iOS typed string keys: `NSFileCreationDate`). */
  global?: string;
  /** A compile-time constant (`static final` primitives and strings). */
  value?: number | string | boolean;
  since?: number | string;
  deprecated?: boolean;
}

export interface SdkClassSchema {
  kind: "class";
  name: string;
  /** Objective-C class (iOS) or JNI class name, `android/os/Build$VERSION` (Android). */
  native: string;
  /** Superclass, as a type reference. */
  extends?: string;
  /** Implemented interfaces (Java), as type references. */
  implements?: string[];
  /** A Java interface, or an Objective-C protocol. */
  interface?: boolean;
  /** Objective-C: declares no initializers but inherits its superclass's. */
  inheritsInit?: boolean;
  abstract?: boolean;
  /** Isolated to the main thread (`@MainActor`, `@UiThread`). */
  mainActor?: boolean;
  since?: number | string;
  constructors?: SdkCallable[];
  methods?: SdkMethodSchema[];
  properties?: SdkPropertySchema[];
}
