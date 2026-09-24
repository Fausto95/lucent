import type { Block } from "../../types";

export const blocks: Block[] = [
  {
    kind: "code",
    filename: "device.lucent.ts",
    code: `import { PLATFORM } from "lucent:platform";
import { UIDevice } from "lucent:ios/UIKit";
import { Build, Build_VERSION } from "lucent:android/android.os";
import { main } from "lucent:thread";

export type DeviceInfo = { platform: string; model: string; label: string };

// Shared code: plain Lucent.
function label(model: string, version: string): string {
  return \`\${model} (\${version})\`;
}

export async function deviceInfo(): Promise<DeviceInfo> {
  if (PLATFORM === "ios") {
    const [model, version] = await main(() => [UIDevice.current.model, UIDevice.current.systemVersion]);
    return { platform: PLATFORM, model, label: label(model, \`iOS \${version}\`) };
  } else {
    const model = Build.MODEL ?? "Android";
    return { platform: PLATFORM, model, label: label(model, \`Android \${Build_VERSION.RELEASE ?? ""}\`) };
  }
}`,
  },
  {
    kind: "list",
    items: [
      "`if (PLATFORM === \"ios\") { … } else { … }` compiles each branch for its own platform. `? :`, `switch (PLATFORM)` and `PLATFORM === \"ios\" && …` work too.",
      "A top-level function, class or variable that uses one platform's SDK outside a branch belongs to that platform, and compiles only there.",
      "Exports run on both platforms, so they branch inside.",
      "Both branches are type-checked on every build. Where a platform's SDK isn't installed, its code is untyped and skipped.",
    ],
  },
  {
    kind: "note",
    tone: "warn",
    text: "A branch needs its `else`. After `if (PLATFORM === \"ios\") return …;`, the code that follows is still shared, so an Android call there fails with `LUCENT3004`.",
  },
  { kind: "h2", text: "When to split into platform files" },
  {
    kind: "p",
    text: "When the two halves share nothing, split the module: `x.lucent.ts` holds only `export declare function`s and types, and `x.ios.lucent.ts` and `x.android.lucent.ts` each implement all of them (`LUCENT3005`). JavaScript imports `x.lucent` either way.",
  },
];
