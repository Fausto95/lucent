import { defineNativeConfig } from "@lucent-lang/core/config";
export default defineNativeConfig({
  capabilities: { crypto: true, filesystem: true, device: true },
});
