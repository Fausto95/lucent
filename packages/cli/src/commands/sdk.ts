import { sdkCommand as extractSdk } from "@lucent-lang/sdk/command";
import { defineCommand } from "./types.ts";

export const sdkCommand = defineCommand({
  name: "sdk",
  glyph: "sdk",
  summary: "Extract native bindings from a Swift interface or a javap listing",
  usage: "swift <file.swiftinterface> --module <Module> --out <dir> | android <javap.txt|-> --out <dir>",
  options: {},
  raw: true,
  examples: [
    {
      command: "lucent sdk swift Foundation.swiftinterface --module Foundation --out sdk/foundation",
      note: "Bindings for public Swift free functions",
    },
    {
      command:
        "lucent sdk android - --classpath $ANDROID_HOME/platforms/android-35/android.jar --class java.lang.Math --out sdk/math",
      note: "Run javap on a class from android.jar",
    },
  ],
  async run(ctx, _values, argv) {
    ctx.ui.heading("sdk", "lucent sdk");
    extractSdk(argv);
    return 0;
  },
});
