import { defineNativeConfig } from "@lucent-lang/core/config";
export default defineNativeConfig({
  libraries: {
    "@lucent-lang/example-text": "./native/text.library.json",
    "@lucent-lang/example-counter": "./native/counter.library.json",
  },
  capabilities: { crypto: true, filesystem: true, device: true },
});
