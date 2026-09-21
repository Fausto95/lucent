import { loadLucentConfig } from "@lucent-lang/host-core";
/** Expo config plugin: runs `lucent build` during prebuild so the generated module is autolinked. */
import {
  createRunOncePlugin,
  withDangerousMod,
  withInfoPlist,
  withEntitlementsPlist,
  withAndroidManifest,
  type ConfigPlugin,
  type ExportedConfigWithProps,
} from "@expo/config-plugins";
import { build, type HostName } from "@lucent-lang/cli";

export interface LucentPluginProps {
  host?: HostName;
}

const withLucentBuild: ConfigPlugin<LucentPluginProps | undefined> = (config, props) => {
  const host = props?.host ?? "expo";
  const run = async (c: ExportedConfigWithProps<unknown>) => {
    if (c.modRequest.introspect) return c;
    const result = await build({
      root: c.modRequest.projectRoot,
      host,
      postGenerate: true,
      log: (line) => console.log(`[lucent] ${line}`),
    });
    if (!result.ok) {
      throw new Error(`Lucent build failed:\n\n${result.diagnostics.map((d) => d.rendered).join("\n\n")}`);
    }
    for (const diagnostic of result.diagnostics) console.warn(diagnostic.rendered);
    return c;
  };
  config = withInfoPlist(config, (c) => {
    const settings = loadLucentConfig(c.modRequest.projectRoot).platformConfig;
    Object.assign(c.modResults, settings.infoPlist);
    return c;
  });
  config = withEntitlementsPlist(config, (c) => {
    Object.assign(c.modResults, loadLucentConfig(c.modRequest.projectRoot).platformConfig.entitlements);
    return c;
  });
  config = withAndroidManifest(config, (c) => {
    const permissions = loadLucentConfig(c.modRequest.projectRoot).platformConfig.androidPermissions;
    const existing = c.modResults.manifest["uses-permission"] ?? [];
    for (const name of permissions)
      if (!existing.some((p) => p.$["android:name"] === name)) existing.push({ $: { "android:name": name } });
    c.modResults.manifest["uses-permission"] = existing;
    return c;
  });
  config = withDangerousMod(config, ["ios", run]);
  config = withDangerousMod(config, ["android", run]);
  return config;
};

const withLucent = createRunOncePlugin(withLucentBuild, "@lucent-lang/expo", "0.0.0");

export default withLucent;
