import { defineNativeConfig } from "@lucent-lang/config";
export default defineNativeConfig({
  libraries: { "@lucent-lang/example-counter": "./native/counter.library.json" },
  capabilities: { clock: true, crypto: true, filesystem: true, network: true, device: true },
});
