import { defineNativeConfig } from "@lucent-lang/config";
export default defineNativeConfig({
  capabilities: { clock: true, crypto: true, filesystem: true, network: true, device: true },
});
