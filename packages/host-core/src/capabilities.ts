export interface PlatformConfig {
  infoPlist: Record<string, string>;
  entitlements: Record<string, string>;
  androidPermissions: string[];
}
interface CapabilityDefinition {
  plist?: string;
  permissions?: string[];
  reason?: boolean;
}
const definitions: Readonly<Record<string, CapabilityDefinition>> = {
  camera: { plist: "NSCameraUsageDescription", permissions: ["android.permission.CAMERA"], reason: true },
  microphone: { plist: "NSMicrophoneUsageDescription", permissions: ["android.permission.RECORD_AUDIO"], reason: true },
  photos: {
    plist: "NSPhotoLibraryUsageDescription",
    permissions: ["android.permission.READ_MEDIA_IMAGES"],
    reason: true,
  },
  location: {
    plist: "NSLocationWhenInUseUsageDescription",
    permissions: ["android.permission.ACCESS_COARSE_LOCATION", "android.permission.ACCESS_FINE_LOCATION"],
    reason: true,
  },
  bluetooth: {
    plist: "NSBluetoothAlwaysUsageDescription",
    permissions: ["android.permission.BLUETOOTH_CONNECT", "android.permission.BLUETOOTH_SCAN"],
    reason: true,
  },
  notifications: { permissions: ["android.permission.POST_NOTIFICATIONS"] },
  network: { permissions: ["android.permission.INTERNET"] },
  filesystem: {},
  crypto: {},
  device: {},
};
const object = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
export function resolveCapabilities(value: unknown): { names: string[]; platformConfig: PlatformConfig } {
  const platformConfig: PlatformConfig = { infoPlist: {}, entitlements: {}, androidPermissions: [] };
  if (value === undefined) return { names: [], platformConfig };
  // Legacy allowlists intentionally retain custom binding capabilities.
  if (Array.isArray(value)) {
    if (value.some((v) => typeof v !== "string")) throw new Error("capabilities must contain names");
    return { names: value as string[], platformConfig };
  }
  if (!object(value)) throw new Error("capabilities must be an object or name list");
  const names: string[] = [];
  for (const [name, options] of Object.entries(value)) {
    const definition = definitions[name];
    if (!definition) throw new Error(`Unknown capability ${name}`);
    if (options === false) continue;
    if (definition.reason) {
      let settings = options;
      if (name === "location") {
        if (!object(options) || Object.keys(options).some((k) => k !== "whenInUse"))
          throw new Error("location requires whenInUse");
        settings = options.whenInUse;
      }
      if (
        !object(settings) ||
        typeof settings.reason !== "string" ||
        !settings.reason.trim() ||
        Object.keys(settings).some((k) => k !== "reason")
      )
        throw new Error(`${name} requires a nonempty reason`);
      platformConfig.infoPlist[definition.plist!] = settings.reason;
    } else if (name === "notifications") {
      if (
        !object(options) ||
        !["development", "production"].includes(String(options.environment)) ||
        Object.keys(options).some((k) => k !== "environment")
      )
        throw new Error("notifications requires an APNs environment");
      platformConfig.entitlements["aps-environment"] = String(options.environment);
    } else if (options !== true) throw new Error(`${name} must be a boolean`);
    names.push(name);
    platformConfig.androidPermissions.push(...(definition.permissions ?? []));
  }
  return { names, platformConfig };
}
const xml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
export function capabilityFiles(config: PlatformConfig): Map<string, string> {
  const plist = (values: Record<string, string>) =>
    '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n<plist version="1.0"><dict>\n' +
    Object.entries(values)
      .map(([key, value]) => `<key>${xml(key)}</key><string>${xml(value)}</string>`)
      .join("\n") +
    "\n</dict></plist>\n";
  return new Map([
    ["ios/LucentInfo.plist", plist(config.infoPlist)],
    ["ios/Lucent.entitlements", plist(config.entitlements)],
    [
      "android/src/main/AndroidManifest.xml",
      '<manifest xmlns:android="http://schemas.android.com/apk/res/android">\n' +
        config.androidPermissions.map((p) => `  <uses-permission android:name="${xml(p)}" />`).join("\n") +
        "\n</manifest>\n",
    ],
    ["lucent-platform-config.json", JSON.stringify(config, null, 2) + "\n"],
  ]);
}
