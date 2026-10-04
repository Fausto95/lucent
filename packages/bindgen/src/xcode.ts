/**
 * What an app's Xcode project says Lucent binds against (TA32): the iOS
 * version its app target is deployed to, and the Swift packages the
 * project references, at the versions Package.resolved pins. Read from the project
 * file itself (an old-style property list) and Package.resolved, as
 * pods are read from what CocoaPods writes.
 */
import fs from "node:fs";
import path from "node:path";

/** A Swift package the app's project references, at the version Package.resolved pins. */
export interface SwiftPackagePin {
  /** SwiftPM's identity: the repository's last path component, lowercased. */
  identity: string;
  location: string;
  version?: string;
  revision: string;
}

export interface XcodeApp {
  project: string;
  /** The app target's IPHONEOS_DEPLOYMENT_TARGET (else the project's). */
  deploymentTarget?: string;
  /** The Swift packages the project references (their dependencies aside). */
  packages: SwiftPackagePin[];
  /** The Package.resolved that pins them. */
  resolved?: string;
}

/** The app's Xcode project in `iosDir` (Pods' aside): undefined without one. */
export function xcodeApp(iosDir: string): XcodeApp | undefined {
  const name = (fs.existsSync(iosDir) ? fs.readdirSync(iosDir) : [])
    .filter((f) => f.endsWith(".xcodeproj") && f !== "Pods.xcodeproj")
    .sort()[0];
  if (!name) return undefined;

  const project = path.join(iosDir, name);
  const file = path.join(project, "project.pbxproj");
  if (!fs.existsSync(file)) return undefined;

  const root = parsePlist(fs.readFileSync(file, "utf8")) as Dict;
  const objects = (root.objects ?? {}) as Record<string, Dict>;
  const object = (id: unknown) => (typeof id === "string" ? objects[id] : undefined);
  const list = (v: unknown) => (Array.isArray(v) ? v : []);

  const projectObject = object(root.rootObject);
  const targets = list(projectObject?.targets).map(object);
  const app = targets.find((t) => t?.productType === "com.apple.product-type.application");

  // Its configurations' deployment target, Debug's first; the project's where it sets none.
  const deploymentOf = (owner: Dict | undefined) => {
    const configs = list(object(owner?.buildConfigurationList)?.buildConfigurations)
      .map(object)
      .sort((a, b) => Number(b?.name === "Debug") - Number(a?.name === "Debug"));
    for (const c of configs) {
      const value = (c?.buildSettings as Dict | undefined)?.IPHONEOS_DEPLOYMENT_TARGET;
      if (typeof value === "string") return value;
    }
    return undefined;
  };
  const deploymentTarget = deploymentOf(app) ?? deploymentOf(projectObject);

  // The packages the project references, by identity: LucentNative links their products.
  const referenced = new Set(
    list(projectObject?.packageReferences)
      .map(object)
      .map((r) => r?.repositoryURL)
      .filter((url): url is string => typeof url === "string")
      .map(identityOf),
  );

  const resolved = [
    path.join(iosDir, name.replace(/\.xcodeproj$/, ".xcworkspace")),
    path.join(project, "project.xcworkspace"),
  ]
    .map((w) => path.join(w, "xcshareddata/swiftpm/Package.resolved"))
    .find((f) => fs.existsSync(f));

  const packages = (resolved ? pinsOf(resolved) : []).filter((p) => referenced.has(p.identity));

  return {
    project,
    ...(deploymentTarget ? { deploymentTarget } : {}),
    packages,
    ...(resolved ? { resolved } : {}),
  };
}

/** SwiftPM's identity of a repository: `https://github.com/acme/Gauges.git` → `gauges`. */
export function identityOf(location: string): string {
  return path
    .basename(location.replace(/\/+$/, ""))
    .replace(/\.git$/, "")
    .toLowerCase();
}

/** Package.resolved's pins, in its version 1 form or the later ones. */
export function pinsOf(resolved: string): SwiftPackagePin[] {
  const json = JSON.parse(fs.readFileSync(resolved, "utf8")) as {
    pins?: { identity?: string; location?: string; state?: Record<string, string> }[];
    object?: {
      pins?: { package?: string; repositoryURL?: string; state?: Record<string, string> }[];
    };
  };
  const pins =
    json.pins ??
    json.object?.pins?.map((p) => ({ location: p.repositoryURL, state: p.state })) ??
    [];

  return pins.flatMap((p) => {
    const location = p.location;
    const revision = p.state?.revision;
    if (!location || !revision) return [];

    const version = p.state?.version;
    return [
      {
        identity: ("identity" in p && p.identity) || identityOf(location),
        location,
        ...(version ? { version } : {}),
        revision,
      },
    ];
  });
}

// --- old-style property lists ---------------------------------------------------------

type Value = string | Value[] | Dict;
type Dict = { [key: string]: Value };

/**
 * An old-style (OpenStep) property list, as project.pbxproj is: braced
 * dictionaries of `key = value;`, parenthesized arrays, quoted or bare
 * strings, and comments.
 */
export function parsePlist(text: string): Value {
  let i = 0;

  const skip = () => {
    for (;;) {
      while (i < text.length && /\s/.test(text[i]!)) i++;
      if (text.startsWith("//", i))
        i = text.indexOf("\n", i) < 0 ? text.length : text.indexOf("\n", i);
      else if (text.startsWith("/*", i)) i = text.indexOf("*/", i) + 2;
      else return;
    }
  };

  const expect = (c: string) => {
    skip();
    if (text[i] !== c) throw new Error(`project.pbxproj: expected ${c} at ${i}`);
    i++;
  };

  const string = (): string => {
    skip();
    if (text[i] === '"') {
      let out = "";
      for (i++; text[i] !== '"'; i++) {
        if (i >= text.length) throw new Error("project.pbxproj: an unterminated string");
        if (text[i] === "\\") {
          const c = text[++i]!;
          out += c === "n" ? "\n" : c === "t" ? "\t" : c;
        } else out += text[i];
      }
      i++;
      return out;
    }

    const start = i;
    while (i < text.length && /[\w$./:-]/.test(text[i]!)) i++;
    if (start === i) throw new Error(`project.pbxproj: a value expected at ${i}`);
    return text.slice(start, i);
  };

  const value = (): Value => {
    skip();
    if (text[i] === "{") {
      i++;
      const dict: Dict = {};
      for (skip(); text[i] !== "}"; skip()) {
        const key = string();
        expect("=");
        dict[key] = value();
        expect(";");
      }
      i++;
      return dict;
    }

    if (text[i] === "(") {
      i++;
      const array: Value[] = [];
      for (skip(); text[i] !== ")"; skip()) {
        array.push(value());
        skip();
        if (text[i] === ",") i++;
      }
      i++;
      return array;
    }

    return string();
  };

  return value();
}
