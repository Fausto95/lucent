import { defineConfig } from "vite-plus";

export default defineConfig({
  run: {
    tasks: {
      build: {
        command: "node scripts/build.mts",
        // The build clears and rewrites these, so reading them isn't an input.
        input: [{ auto: true }, "!dist/**", "!lib/**", "!runtime/**"],
        output: ["dist/**", "lib/**", "runtime/**"],
      },
    },
  },
});
