"use strict";
// iOS app extensions' targets in the app (decision 0124): what the Expo
// config plugin, and lucent init for a bare app, add from the native
// package's ios-extensions.json. Each extension is a target of the app's
// Xcode project, embedded in the app, with its Info.plist, entitlements and
// the one source that links its principal class, and a target of the
// Podfile naming its subspec of LucentExtensions.podspec. A target that
// exists already is left as it is: the app may have changed it.
const fs = require("node:fs");
const path = require("node:path");

/** The manifest's format this reads; another is refused (app-extension-targets.ts). */
const FORMAT = 1;

/** The native package's ios-extensions.json, or undefined without one. */
function readExtensionTargets(projectRoot, nativePackage = path.join(".lucent", "native")) {
  const file = path.join(projectRoot, nativePackage, "ios-extensions.json");
  if (!fs.existsSync(file)) return undefined;
  const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
  if (manifest.format !== FORMAT)
    throw new Error(
      `${file} is of format ${manifest.format}, which this Lucent doesn't read: run lucent build again`,
    );
  return manifest;
}

const escapeXml = (s) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** A property list's XML: strings, booleans, arrays and dictionaries, keys sorted. */
function plistXml(value) {
  const node = (v, indent) => {
    const pad = "\t".repeat(indent);
    if (typeof v === "boolean") return `${pad}<${v}/>`;
    if (typeof v === "string") return `${pad}<string>${escapeXml(v)}</string>`;
    if (Array.isArray(v))
      return v.length
        ? `${pad}<array>\n${v.map((x) => node(x, indent + 1)).join("\n")}\n${pad}</array>`
        : `${pad}<array/>`;
    const keys = Object.keys(v).sort();
    if (!keys.length) return `${pad}<dict/>`;
    return `${pad}<dict>\n${keys
      .map((k) => `${pad}\t<key>${escapeXml(k)}</key>\n${node(v[k], indent + 1)}`)
      .join("\n")}\n${pad}</dict>`;
  };
  return (
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
    '<plist version="1.0">\n' +
    `${node(value, 0)}\n` +
    "</plist>\n"
  );
}

/** The files of each extension's directory, relative to the iOS project's: `<name>/<file>`. */
function extensionFiles(manifest) {
  const out = [];
  for (const e of manifest.extensions) {
    out.push([`${e.name}/Info.plist`, plistXml(e.infoPlist)]);
    out.push([`${e.name}/${e.name}.entitlements`, plistXml(e.entitlements)]);
    for (const [file, text] of Object.entries(e.sources)) out.push([`${e.name}/${file}`, text]);
  }
  return out;
}

/** Writes each extension's files under `iosDir`, leaving one that holds them already alone. */
function writeExtensionFiles(iosDir, manifest) {
  for (const [rel, text] of extensionFiles(manifest)) {
    const file = path.join(iosDir, rel);
    if (fs.existsSync(file) && fs.readFileSync(file, "utf8") === text) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, text);
  }
}

/** The Lucent comment that marks the Podfile's extension targets. */
const POD_MARK = "# Lucent's app extensions (decision 0124): a target each.";

/**
 * The Podfile with a target per extension naming its subspec, from the
 * native package (`podPath`, relative to the Podfile), or undefined when
 * it has them all.
 */
function withExtensionPods(podfile, manifest, podPath) {
  const missing = manifest.extensions.filter(
    (e) => !new RegExp(`^\\s*target\\s+['"]${e.name}['"]\\s+do`, "m").test(podfile),
  );
  if (!missing.length) return undefined;

  const blocks = missing.map(
    (e) => `target '${e.name}' do\n  pod '${e.pod}', :path => '${podPath}'\nend\n`,
  );
  const head = podfile.includes(POD_MARK) ? "" : `\n${POD_MARK}\n`;
  return `${podfile.replace(/\n*$/, "\n")}${head}${blocks.join("\n")}`;
}

const unquote = (s) => (typeof s === "string" ? s.replace(/^"(.*)"$/, "$1") : s);

/** The project's native target named `name`, quoted or not in the file, with its uuid. */
function targetNamed(project, name) {
  for (const [uuid, target] of Object.entries(project.pbxNativeTargetSection()))
    if (typeof target === "object" && unquote(target.name) === name) return { uuid, target };
  return undefined;
}

/** The build settings of the app's target's configurations, by configuration name. */
function appSettings(project, appTarget) {
  const configs = project.pbxXCBuildConfigurationSection();
  const list = project.pbxXCConfigurationList()[appTarget.buildConfigurationList];
  const out = {};
  for (const ref of list?.buildConfigurations ?? []) {
    const c = configs[ref.value];
    if (c?.buildSettings) out[c.name] = c.buildSettings;
  }
  return out;
}

/** What an extension's target copies from the app's, when the app sets it. */
const FROM_APP = [
  "CURRENT_PROJECT_VERSION",
  "DEVELOPMENT_TEAM",
  "IPHONEOS_DEPLOYMENT_TARGET",
  "MARKETING_VERSION",
  "TARGETED_DEVICE_FAMILY",
];

const quoted = (s) => (/^[\w.$()/-]+$/.test(s) ? s : JSON.stringify(s));

/**
 * Adds each extension's target the Xcode project lacks: an app extension
 * of the app's bundle identifier with the extension's name, its files in a
 * group of its own, its source compiled, embedded in the app's target,
 * which builds it first. `app` gives the app's target's name (default: the
 * project's first target), its bundle identifier, and its version and
 * build number when its build settings have none (an Expo app's come from
 * app.json). True when it added one.
 */
function withExtensionTargets(project, manifest, app) {
  const objects = project.hash.project.objects;
  // xcode's addTargetDependency needs both sections, which a fresh project may lack.
  objects.PBXTargetDependency ??= {};
  objects.PBXContainerItemProxy ??= {};

  const first = project.getFirstTarget();
  const found = app.target
    ? targetNamed(project, app.target)
    : { uuid: first.uuid, target: first.firstTarget };
  if (!found) throw new Error(`the Xcode project has no target ${app.target}`);
  if (!app.bundleIdentifier)
    throw new Error("the app's bundle identifier is needed: its extensions' are under it");
  const settings = appSettings(project, found.target);

  let added = false;
  for (const e of manifest.extensions) {
    if (targetNamed(project, e.name)) continue;
    added = true;

    const target = project.addTarget(
      e.name,
      "app_extension",
      e.name,
      `${app.bundleIdentifier}.${e.name}`,
    );
    const sources = Object.keys(e.sources);
    const files = ["Info.plist", `${e.name}.entitlements`, ...sources];
    const group = project.addPbxGroup(files, e.name, e.name);
    project.addToPbxGroup(group.uuid, project.getFirstProject().firstProject.mainGroup);
    project.addBuildPhase(sources, "PBXSourcesBuildPhase", "Sources", target.uuid);
    project.addBuildPhase([], "PBXResourcesBuildPhase", "Resources", target.uuid);
    project.addBuildPhase([], "PBXFrameworksBuildPhase", "Frameworks", target.uuid);
    project.addTargetDependency(found.uuid, [target.uuid]);

    // Its configurations: the app's version, team, deployment target and devices, its own files.
    const configs = project.pbxXCBuildConfigurationSection();
    const list = project.pbxXCConfigurationList()[target.pbxNativeTarget.buildConfigurationList];
    for (const ref of list.buildConfigurations) {
      const c = configs[ref.value];
      const fromApp = settings[c.name] ?? settings.Release ?? {};
      for (const key of FROM_APP)
        if (fromApp[key] !== undefined) c.buildSettings[key] = fromApp[key];
      c.buildSettings.MARKETING_VERSION ??= quoted(app.version ?? "1.0");
      c.buildSettings.CURRENT_PROJECT_VERSION ??= quoted(app.buildNumber ?? "1");
      Object.assign(c.buildSettings, {
        APPLICATION_EXTENSION_API_ONLY: "YES",
        CLANG_ENABLE_MODULES: "YES",
        CLANG_ENABLE_OBJC_ARC: "YES",
        CODE_SIGN_ENTITLEMENTS: quoted(`${e.name}/${e.name}.entitlements`),
        CODE_SIGN_STYLE: "Automatic",
        INFOPLIST_FILE: quoted(`${e.name}/Info.plist`),
        PRODUCT_BUNDLE_IDENTIFIER: quoted(`${app.bundleIdentifier}.${e.name}`),
        PRODUCT_NAME: '"$(TARGET_NAME)"',
        SKIP_INSTALL: "YES",
      });
    }
  }
  return added;
}

module.exports = {
  extensionFiles,
  plistXml,
  readExtensionTargets,
  withExtensionPods,
  withExtensionTargets,
  writeExtensionFiles,
};
