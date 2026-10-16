/**
 * What adding an iOS app extension's target to the app takes (decision
 * 0124), which the native package records in `ios-extensions.json` for the
 * Expo plugin and `lucent init` to add: per extension, its target's name,
 * its subspec of LucentExtensions.podspec, its Info.plist and entitlements,
 * and the files its target compiles. Without TypeScript or the compiler's
 * other modules.
 */
import type { AppExtension } from "./package-schema.ts";
import type { ResolvedNative } from "./package-config.ts";
import { osObjcName, widgetName } from "./os-names.ts";

/** The manifest's file, in the native package. */
export const APP_EXTENSIONS_MANIFEST = "ios-extensions.json";

/** Its format: a reader of another refuses it. */
export const APP_EXTENSIONS_FORMAT = 1;

/** A property list value, as an extension's Info.plist and entitlements hold them. */
export type PlistNode = string | boolean | PlistNode[] | { [key: string]: PlistNode };

/** One extension's target. */
export interface AppExtensionTarget {
  name: string;
  kind: AppExtension["kind"];
  /** Its subspec of LucentExtensions.podspec, which its target in the Podfile names. */
  pod: string;
  /**
   * Its Info.plist. Its version keys are `$(MARKETING_VERSION)` and
   * `$(CURRENT_PROJECT_VERSION)`, which its target sets as the app's are:
   * an extension's version is its app's.
   */
  infoPlist: Record<string, PlistNode>;
  /** Its entitlements: the app's App Groups, and its own. */
  entitlements: Record<string, PlistNode>;
  /** The files its target compiles, by name: what links its code, or a widget's entry point. */
  sources: Record<string, string>;
}

export interface AppExtensionsManifest {
  format: number;
  /** The native package's directory, relative to the project's: where the Podfile finds the pod. */
  nativePackage: string;
  extensions: AppExtensionTarget[];
}

/** The extension point a kind's target is for. */
const EXTENSION_POINTS: Record<AppExtension["kind"], string> = {
  notificationService: "com.apple.usernotifications.service",
  share: "com.apple.share-services",
  widget: "com.apple.widgetkit-extension",
};

/** The entitlement an App Group is. */
const APP_GROUPS = "com.apple.security.application-groups";

/** The targets of the extensions the build built (`built`), from what the packages resolved. */
export function appExtensionTargets(
  resolved: ResolvedNative,
  built: readonly string[],
  nativePackage: string,
): AppExtensionsManifest | undefined {
  const groups = Object.keys(resolved.ios.appGroups ?? {});
  const extensions = Object.values(resolved.ios.appExtensions ?? {})
    .map((a) => a.value)
    .filter((e) => built.includes(e.name) && (e.class !== undefined || e.kind === "widget"))
    .map((e) => target(e, groups));

  return extensions.length
    ? { format: APP_EXTENSIONS_FORMAT, nativePackage, extensions }
    : undefined;
}

function target(e: AppExtension, groups: string[]): AppExtensionTarget {
  // A widget's entry point is its bundle (its Swift's `@main`); another extension's, the class
  // NSExtensionPrincipalClass names, which the OS makes.
  const [module, cls] = e.class ? (e.class.split("#") as [string, string]) : [];
  const principal = module && cls ? osObjcName(module, cls) : undefined;

  // Its own Info.plist keys: NSExtension… ones are the extension point's attributes.
  const own = Object.entries(e.infoPlist ?? {});
  const attributes = Object.fromEntries(own.filter(([k]) => k.startsWith("NSExtension")));
  const extension: Record<string, PlistNode> = {
    NSExtensionPointIdentifier: EXTENSION_POINTS[e.kind],
    ...(principal ? { NSExtensionPrincipalClass: principal } : {}),
    ...(Object.keys(attributes).length ? { NSExtensionAttributes: attributes } : {}),
  };
  const infoPlist: Record<string, PlistNode> = {
    CFBundleDevelopmentRegion: "$(DEVELOPMENT_LANGUAGE)",
    CFBundleDisplayName: e.displayName ?? e.name,
    CFBundleExecutable: "$(EXECUTABLE_NAME)",
    CFBundleIdentifier: "$(PRODUCT_BUNDLE_IDENTIFIER)",
    CFBundleInfoDictionaryVersion: "6.0",
    CFBundleName: "$(PRODUCT_NAME)",
    CFBundlePackageType: "$(PRODUCT_BUNDLE_PACKAGE_TYPE)",
    CFBundleShortVersionString: "$(MARKETING_VERSION)",
    CFBundleVersion: "$(CURRENT_PROJECT_VERSION)",
    ...Object.fromEntries(own.filter(([k]) => !k.startsWith("NSExtension"))),
    NSExtension: extension,
  };

  const entitlements: Record<string, PlistNode> = { ...e.entitlements };
  const had = entitlements[APP_GROUPS];
  const joined = [...new Set([...(Array.isArray(had) ? (had as string[]) : []), ...groups])];
  if (joined.length) entitlements[APP_GROUPS] = joined;

  return {
    name: e.name,
    kind: e.kind,
    pod: `LucentExtensions/${e.name}`,
    infoPlist,
    entitlements,
    sources: principal
      ? { "LucentExtension.m": linkSource(e.name, principal) }
      : { "LucentWidget.swift": widgetSource(e.name) },
  };
}

/**
 * A widget's target's one source: its entry point, a bundle of the widget
 * its subspec of LucentExtensions writes (`LucentWidget_<name>`).
 */
function widgetSource(name: string): string {
  return `// Generated by Lucent. Do not edit.
// ${name}'s entry point (decision 0124): the widget its subspec of LucentExtensions
// builds, from its provider and its body.
import LucentExtensions
import SwiftUI
import WidgetKit

@main
struct LucentWidgetBundle: WidgetBundle {
  var body: some Widget {
    LucentWidget_${widgetName(name)}()
  }
}
`;
}

/**
 * The target's one source: a reference to its principal class, which the
 * linker then takes from the extension's subspec, a static library.
 */
function linkSource(name: string, principal: string): string {
  return `// Generated by Lucent. Do not edit.
// Links ${name}'s principal class, which its subspec of LucentExtensions builds
// (decision 0124): NSExtensionPrincipalClass names it.
#import <Foundation/Foundation.h>

@interface ${principal} : NSObject
@end

__attribute__((used)) static Class lucentPrincipalClass(void) { return [${principal} class]; }
`;
}
