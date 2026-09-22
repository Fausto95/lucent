/** Known top-level keys of target `lucent.package.json` (docs/packages.md). */
const KNOWN_FIELDS = new Set([
  "schemaVersion",
  "name",
  "platforms",
  "minVersions",
  "nativeDependencies",
  "sdkRequirements",
  "compiler",
  "hosts",
  "permissions",
  "capabilities",
]);

const PLATFORMS = new Set(["ios", "android"]);
const HOSTS = new Set(["expo", "nitro"]);

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function checkStringMap(label: string, value: unknown, messages: string[]): void {
  if (!isPlainObject(value)) {
    messages.push(`${label} must be an object`);
    return;
  }
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry !== "string") messages.push(`${label}.${key} must be a string`);
  }
}

function checkStringList(label: string, value: unknown, messages: string[]): void {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    messages.push(`${label} must be an array of strings`);
  }
}

/**
 * Validate a parsed `lucent.package.json` object.
 * Returns error strings for invalid known fields and `warning:` strings for unknown keys.
 */
export function validateLucentPackage(json: unknown): string[] {
  const messages: string[] = [];
  if (!isPlainObject(json)) return ["lucent.package.json must be a JSON object"];

  for (const key of Object.keys(json)) {
    if (!KNOWN_FIELDS.has(key)) messages.push(`warning: unknown field "${key}"`);
  }

  if ("schemaVersion" in json && (typeof json.schemaVersion !== "number" || !Number.isInteger(json.schemaVersion))) {
    messages.push("schemaVersion must be an integer");
  }

  if ("name" in json && typeof json.name !== "string") messages.push("name must be a string");

  if ("platforms" in json) {
    if (!Array.isArray(json.platforms)) messages.push("platforms must be an array");
    else
      for (const platform of json.platforms) {
        if (typeof platform !== "string" || !PLATFORMS.has(platform)) {
          messages.push(`platforms entry must be "ios" or "android", got ${JSON.stringify(platform)}`);
        }
      }
  }

  if ("minVersions" in json) {
    if (!isPlainObject(json.minVersions)) messages.push("minVersions must be an object");
    else {
      if ("ios" in json.minVersions && typeof json.minVersions.ios !== "string") {
        messages.push("minVersions.ios must be a string");
      }
      if ("android" in json.minVersions && typeof json.minVersions.android !== "number") {
        messages.push("minVersions.android must be a number");
      }
      for (const key of Object.keys(json.minVersions)) {
        if (key !== "ios" && key !== "android") messages.push(`warning: unknown field "minVersions.${key}"`);
      }
    }
  }

  if ("nativeDependencies" in json) {
    if (!isPlainObject(json.nativeDependencies)) messages.push("nativeDependencies must be an object");
    else {
      for (const [platform, deps] of Object.entries(json.nativeDependencies)) {
        if (!PLATFORMS.has(platform)) {
          messages.push(`warning: unknown field "nativeDependencies.${platform}"`);
          continue;
        }
        checkStringMap(`nativeDependencies.${platform}`, deps, messages);
      }
    }
  }

  if ("sdkRequirements" in json) {
    if (!isPlainObject(json.sdkRequirements)) messages.push("sdkRequirements must be an object");
    else {
      for (const [platform, reqs] of Object.entries(json.sdkRequirements)) {
        if (!PLATFORMS.has(platform)) {
          messages.push(`warning: unknown field "sdkRequirements.${platform}"`);
          continue;
        }
        checkStringList(`sdkRequirements.${platform}`, reqs, messages);
      }
    }
  }

  if ("compiler" in json && typeof json.compiler !== "string") messages.push("compiler must be a string");

  if ("hosts" in json) {
    if (!Array.isArray(json.hosts)) messages.push("hosts must be an array");
    else
      for (const host of json.hosts) {
        if (typeof host !== "string" || !HOSTS.has(host)) {
          messages.push(`hosts entry must be "expo" or "nitro", got ${JSON.stringify(host)}`);
        }
      }
  }

  if ("permissions" in json && !isPlainObject(json.permissions)) {
    messages.push("permissions must be an object");
  }

  if ("capabilities" in json && !isPlainObject(json.capabilities)) {
    messages.push("capabilities must be an object");
  }

  return messages;
}
