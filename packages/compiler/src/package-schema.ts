/**
 * The shape of a Lucent package's lucent.json, and its check: every field
 * the build reads is typed, and anything else fails, naming the package and
 * where the problem is.
 */
import fs from "node:fs";
import path from "node:path";
import type { LucentPackage } from "./packages.ts";

/** An Info.plist value a package can ask for. */
export type PlistValue = string | boolean | string[];

/** How a Swift package's version is chosen, as Xcode records it. */
export type SwiftPackageRequirement =
  | { kind: "upToNextMajorVersion" | "upToNextMinorVersion"; minimumVersion: string }
  | { kind: "exactVersion"; version: string }
  | { kind: "versionRange"; minimumVersion: string; maximumVersion: string }
  | { kind: "branch"; branch: string }
  | { kind: "revision"; revision: string };

/** Each requirement kind and its fields, in the order Xcode writes them. */
export const SWIFT_PACKAGE_REQUIREMENTS: Record<SwiftPackageRequirement["kind"], string[]> = {
  upToNextMajorVersion: ["minimumVersion"],
  upToNextMinorVersion: ["minimumVersion"],
  exactVersion: ["version"],
  versionRange: ["minimumVersion", "maximumVersion"],
  branch: ["branch"],
  revision: ["revision"],
};

/** A Swift package the pod depends on, and the products it links. */
export interface SwiftPackage {
  requirement: SwiftPackageRequirement;
  products: string[];
}

/** An `<intent-filter>`'s `<data>`. */
export interface IntentData {
  scheme?: string;
  host?: string;
  port?: string;
  path?: string;
  pathPrefix?: string;
  pathPattern?: string;
  mimeType?: string;
}

export interface IntentFilter {
  actions: string[];
  categories?: string[];
  data?: IntentData[];
}

/** An Android manifest component: an `<activity>`, `<service>`, `<receiver>` or `<provider>`. */
export interface ManifestComponent {
  kind: "activity" | "service" | "receiver" | "provider";
  /** Fully qualified class name. */
  name: string;
  exported?: boolean;
  enabled?: boolean;
  permission?: string;
  /** Required for a provider. */
  authorities?: string;
  grantUriPermissions?: boolean;
  foregroundServiceType?: string;
  /** An activity's theme (`@android:style/Theme.Translucent.NoTitleBar`). */
  theme?: string;
  /** Configuration changes an activity handles itself instead of being recreated (`orientation|screenSize`). */
  configChanges?: string;
  intentFilters?: IntentFilter[];
  /** `<meta-data>` name → value. */
  metaData?: Record<string, string>;
}

/**
 * A native extension: a C header whose functions Lucent code calls, and
 * what those functions do that C declarations cannot say. Every name is a
 * C declaration of the header, checked against what clang reads.
 */
export interface ExtensionDeclaration {
  /** The header, relative to the package: in a directory both ios.nativeSources and android.nativeSources list. */
  header: string;
  /** C type name (an opaque struct) → the handle Lucent code holds. */
  handles?: Record<string, HandleDeclaration>;
  /** C function name → what its parameters and result mean. */
  functions?: Record<string, FunctionDeclaration>;
  /** C struct name → the error a function fills in when it fails. */
  errors?: Record<string, ErrorDeclaration>;
}

export interface HandleDeclaration {
  /** Makes one (`new`): returns a pointer to the type, null when it fails. */
  create: string;
  /** Takes the pointer (`void f(T*)`); runs once, when the handle closes. */
  destroy: string;
  /** Method name → the function it calls, with the handle as its first argument. */
  methods?: Record<string, string>;
  /** The thread the handle is used and destroyed on: any, one call at a time (the default), or the main thread. */
  affinity?: Affinity;
}

export type Affinity = "any" | "main";

/** How a C result says the call failed. */
export type FailsWhen = "null" | "negative" | "nonzero" | "zero" | "false";

export interface FunctionDeclaration {
  /** C parameter name → what it is; numbers, booleans and handles need nothing. */
  params?: Record<string, ParamDeclaration>;
  /** How the result says the call failed; none: it cannot fail. */
  failsWhen?: FailsWhen;
  /** The thread it may be called on: any (the default) or the main thread. */
  affinity?: Affinity;
  /** It may block (I/O, locks, long work): calling it on the main thread is a warning. */
  blocking?: boolean;
}

/**
 * A pointer parameter: bytes it reads or writes, as many as its length
 * parameter says (a Uint8Array, for both); a NUL-terminated UTF-8 string;
 * or the error it fills in. None escapes the call.
 */
export type ParamDeclaration =
  | { bytes: "read" | "write"; length: string }
  | { string: "utf8" }
  | { error: string };

export interface ErrorDeclaration {
  /** An integer field: the error's code. */
  code?: string;
  /** A `const char *` field: the message, read before the call returns. */
  message: string;
  /** Called with the struct once it was read (`void f(E*)`), when it holds something to free. */
  release?: string;
}

/** A package's lucent.json. */
export interface PackageNative {
  ios?: {
    pods?: Record<string, string>;
    frameworks?: string[];
    infoPlist?: Record<string, PlistValue>;
    /** Directories of sources compiled into the pod (C, C++, Objective-C, Swift). */
    nativeSources?: string[];
    /** Files or directories copied to the app bundle's root. */
    resources?: string[];
    /** Bundle name → files or directories copied into that bundle. */
    resourceBundles?: Record<string, string[]>;
    /** `.framework` and `.xcframework` directories the pod links and embeds. */
    vendoredFrameworks?: string[];
    /** Package URL → its requirement and the products the pod links. */
    swiftPackages?: Record<string, SwiftPackage>;
    /** The app's entitlements the code needs. */
    entitlements?: Record<string, PlistValue>;
    /** The lowest iOS version the code runs on (`"15.1"`). */
    deploymentTarget?: string;
  };
  android?: {
    dependencies?: Record<string, string>;
    permissions?: string[];
    /** Java and Kotlin source roots; their C and C++ files join the runtime's CMake target. */
    nativeSources?: string[];
    /** Android resource directories (`res` layout). */
    resources?: string[];
    /** Asset directories. */
    assets?: string[];
    /** `.aar` and `.jar` files the library depends on (api). */
    libraries?: string[];
    /** Directories of prebuilt `<abi>/lib*.so` libraries packaged into the app. */
    nativeLibraries?: string[];
    components?: ManifestComponent[];
    /** The lowest Android API level the code runs on. */
    minSdk?: number;
  };
  /** Extension name (`lucent:ext/<name>`) → the extension. */
  extensions?: Record<string, ExtensionDeclaration>;
}

/** Checks a lucent.json value: an error message naming where it is, or undefined. */
type Check = (value: unknown, at: string) => string | undefined;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const isStrings = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((x) => typeof x === "string");

const string: Check = (v, at) => (typeof v === "string" ? undefined : `${at} must be a string`);

const strings: Check = (v, at) => (isStrings(v) ? undefined : `${at} must be an array of strings`);

const plistValue: Check = (v, at) =>
  typeof v === "string" || typeof v === "boolean" || isStrings(v)
    ? undefined
    : `${at} must be a string, a boolean or an array of strings`;

const boolean: Check = (v, at) => (typeof v === "boolean" ? undefined : `${at} must be a boolean`);

const version: Check = (v, at) =>
  typeof v === "string" && /^\d+(\.\d+){0,2}$/.test(v)
    ? undefined
    : `${at} must be a version such as "15.1"`;

const positiveInteger: Check = (v, at) =>
  Number.isInteger(v) && (v as number) > 0 ? undefined : `${at} must be a positive integer`;

const className: Check = (v, at) =>
  typeof v === "string" && /^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)+$/.test(v)
    ? undefined
    : `${at} must be a fully qualified class name`;

const oneOf =
  (values: readonly string[]): Check =>
  (v, at) =>
    typeof v === "string" && values.includes(v)
      ? undefined
      : `${at} must be one of ${values.join(", ")}`;

const listOf =
  (item: Check): Check =>
  (v, at) => {
    if (!Array.isArray(v)) return `${at} must be an array`;

    for (const [i, x] of v.entries()) {
      const error = item(x, `${at}.${i}`);
      if (error) return error;
    }

    return undefined;
  };

/** `check`, then `rule` on a value `check` accepted. */
const refine =
  (check: Check, rule: (v: Record<string, unknown>, at: string) => string | undefined): Check =>
  (v, at) =>
    check(v, at) ?? rule(v as Record<string, unknown>, at);

const recordOf =
  (item: Check): Check =>
  (v, at) => {
    if (!isObject(v)) return `${at} must be an object`;

    for (const [key, x] of Object.entries(v)) {
      const error = item(x, `${at}.${key}`);
      if (error) return error;
    }

    return undefined;
  };

const fields =
  (spec: Record<string, Check>, required: string[] = []): Check =>
  (v, at) => {
    if (!isObject(v)) return `${at || "the file"} must be an object`;

    const missing = required.find((key) => v[key] === undefined);
    if (missing) return `${at}.${missing} is required`;

    for (const [key, x] of Object.entries(v)) {
      const where = at ? `${at}.${key}` : key;
      const check = spec[key];

      if (!check) return `unknown field ${where}`;

      const error = check(x, where);
      if (error) return error;
    }

    return undefined;
  };

const swiftPackageRequirement: Check = (v, at) => {
  const kind = isObject(v) ? (v.kind as SwiftPackageRequirement["kind"]) : undefined;
  const expected =
    kind && Object.hasOwn(SWIFT_PACKAGE_REQUIREMENTS, kind)
      ? SWIFT_PACKAGE_REQUIREMENTS[kind]
      : undefined;
  const exact =
    expected &&
    Object.keys(v as object).length === expected.length + 1 &&
    expected.every((f) => typeof (v as Record<string, unknown>)[f] === "string");

  return exact
    ? undefined
    : `${at} must be a Swift package requirement: { kind, … } with kind ${Object.keys(SWIFT_PACKAGE_REQUIREMENTS).join(", ")}`;
};

const intentFilter = fields(
  {
    actions: strings,
    categories: strings,
    data: listOf(
      fields({
        scheme: string,
        host: string,
        port: string,
        path: string,
        pathPrefix: string,
        pathPattern: string,
        mimeType: string,
      }),
    ),
  },
  ["actions"],
);

const component = refine(
  fields(
    {
      kind: oneOf(["activity", "service", "receiver", "provider"]),
      name: className,
      exported: boolean,
      enabled: boolean,
      permission: string,
      authorities: string,
      grantUriPermissions: boolean,
      foregroundServiceType: string,
      theme: string,
      configChanges: string,
      intentFilters: listOf(intentFilter),
      metaData: recordOf(string),
    } satisfies Record<keyof ManifestComponent, Check>,
    ["kind", "name"],
  ),
  (v, at) =>
    v.kind === "provider" && v.authorities === undefined
      ? `${at}.authorities is required for a provider`
      : undefined,
);

/** Every field the build reads from a lucent.json, per platform, and how it is checked. */
export const PACKAGE_FIELDS = {
  ios: {
    pods: recordOf(string),
    frameworks: strings,
    infoPlist: recordOf(plistValue),
    nativeSources: strings,
    resources: strings,
    resourceBundles: recordOf(strings),
    vendoredFrameworks: strings,
    swiftPackages: recordOf(
      fields({ requirement: swiftPackageRequirement, products: strings }, [
        "requirement",
        "products",
      ]),
    ),
    entitlements: recordOf(plistValue),
    deploymentTarget: version,
  },
  android: {
    dependencies: recordOf(string),
    permissions: strings,
    nativeSources: strings,
    resources: strings,
    assets: strings,
    libraries: strings,
    nativeLibraries: strings,
    components: listOf(component),
    minSdk: positiveInteger,
  },
} satisfies {
  [P in Platform]: {
    [F in keyof Required<NonNullable<PackageNative[P]>>]: Check;
  };
};

type Platform = "ios" | "android";

/** A C name: a function, struct, typedef or parameter of the header. */
const cName: Check = (v, at) =>
  typeof v === "string" && /^[A-Za-z_]\w*$/.test(v) ? undefined : `${at} must be a C name`;

/** A record whose keys are C names too. */
const namedOf =
  (item: Check): Check =>
  (v, at) =>
    recordOf(item)(v, at) ??
    Object.keys(v as object)
      .map(
        (key) =>
          cName(key, `${at}.${key}`) && `${at} has ${JSON.stringify(key)}, which is not a C name`,
      )
      .find(Boolean);

const affinity = oneOf(["any", "main"]);

const param: Check = (v, at) => {
  const kind = isObject(v) ? ["bytes", "string", "error"].find((k) => k in v) : undefined;

  if (kind === "bytes")
    return fields({ bytes: oneOf(["read", "write"]), length: cName }, ["bytes", "length"])(v, at);
  if (kind === "string") return fields({ string: oneOf(["utf8"]) }, ["string"])(v, at);
  if (kind === "error") return fields({ error: cName }, ["error"])(v, at);

  return `${at} must be { bytes, length }, { string } or { error }`;
};

/** Every field of an extension, and how it is checked. */
export const EXTENSION_FIELDS = {
  header: string,
  handles: namedOf(
    fields(
      {
        create: cName,
        destroy: cName,
        methods: recordOf(cName),
        affinity,
      } satisfies Record<keyof HandleDeclaration, Check>,
      ["create", "destroy"],
    ),
  ),
  functions: namedOf(
    fields({
      params: namedOf(param),
      failsWhen: oneOf(["null", "negative", "nonzero", "zero", "false"]),
      affinity,
      blocking: boolean,
    } satisfies Record<keyof FunctionDeclaration, Check>),
  ),
  errors: namedOf(
    fields(
      { code: cName, message: cName, release: cName } satisfies Record<
        keyof ErrorDeclaration,
        Check
      >,
      ["message"],
    ),
  ),
} satisfies Record<keyof ExtensionDeclaration, Check>;

/** An extension's name, as `lucent:ext/<name>` imports it. */
export const EXTENSION_NAME = /^[A-Za-z][\w-]*$/;

const extensions: Check = (v, at) =>
  recordOf(fields(EXTENSION_FIELDS, ["header"]))(v, at) ??
  Object.keys(v as object)
    .filter((name) => !EXTENSION_NAME.test(name))
    .map(
      (name) =>
        `${at} has ${JSON.stringify(name)}: an extension's name is a letter, then letters, digits, _ or -`,
    )
    .find(Boolean);

const lucentJson = fields({
  ios: fields(PACKAGE_FIELDS.ios),
  android: fields(PACKAGE_FIELDS.android),
  extensions,
});

/** A package's lucent.json, checked; undefined when it has none. */
export function readPackageNative(pkg: LucentPackage): PackageNative | undefined {
  const file = path.join(pkg.dir, "lucent.json");

  if (!fs.existsSync(file)) return undefined;

  const fail = (message: string): never => {
    throw new Error(`${pkg.name}/lucent.json: ${message}`);
  };

  let value: unknown;
  try {
    value = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    fail((e as Error).message);
  }

  const error = lucentJson(value, "");
  if (error) fail(error);

  return value as PackageNative;
}
