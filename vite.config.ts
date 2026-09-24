import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts", "apps/website/test/**/*.test.ts"],
    testTimeout: 60000,
    globalSetup: ["./vitest.setup-tmp.ts", "./vitest.setup-sdk.ts"],
    setupFiles: ["./vitest.setup-yield.ts"],
  },
});
