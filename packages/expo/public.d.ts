import type { ConfigPlugin } from "@expo/config-plugins";
export interface LucentPluginProps {
  host?: "expo" | "nitro";
}
declare const withLucent: ConfigPlugin<LucentPluginProps | undefined>;
export default withLucent;
