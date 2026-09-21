/** Expo config plugin: runs `lucent build` during prebuild so the generated module is autolinked. */
import {
  createRunOncePlugin,
  withDangerousMod,
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
    return c;
  };
  config = withDangerousMod(config, ["ios", run]);
  config = withDangerousMod(config, ["android", run]);
  return config;
};

const withLucent = createRunOncePlugin(withLucentBuild, "@lucent-lang/expo", "0.0.0");

export default withLucent;
