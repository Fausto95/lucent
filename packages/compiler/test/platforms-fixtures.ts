/** Projects and modules the platform tests compile. */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

/** `sources` written into a fresh directory: their paths. */
export function project(sources: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-platforms-"));
  return Object.entries(sources).map(([name, src]) => {
    const f = path.join(dir, name);
    fs.writeFileSync(f, src);
    return f;
  });
}

/** A module with an iOS and an Android implementation, each calling its SDK. */
export const haptics = {
  "haptics.lucent.ts":
    "export declare function impact(): Promise<void>;\nexport declare function model(): Promise<string>;\n",
  "haptics.ios.lucent.ts": `import { UIDevice, UIImpactFeedbackGenerator, UIImpactFeedbackGenerator_FeedbackStyle as Style } from "lucent:ios/UIKit";
import { main } from "lucent:thread";

export function impact(): Promise<void> {
  return main(() => {
    const generator = new UIImpactFeedbackGenerator(Style.medium);
    generator.prepare();
    generator.impactOccurred();
    generator.impactOccurred(0.5);
  });
}

export function model(): Promise<string> {
  return main(() => (UIDevice.current === UIDevice.current ? UIDevice.current.model : ""));
}
`,
  "haptics.android.lucent.ts": `import { Build, Build_VERSION, Looper, VibrationEffect, Vibrator, VibratorManager } from "lucent:android/android.os";
import { appContext, available } from "lucent:android";

export async function impact(): Promise<void> {
  const context = appContext();
  const vibrator = available("android", 31) ? context.getSystemService(VibratorManager)?.defaultVibrator : context.getSystemService(Vibrator);
  if (!vibrator) return;
  if (Build_VERSION.SDK_INT >= 26) vibrator.vibrate(VibrationEffect.createWaveform([0n, 43n], [0, 50], -1));
  else vibrator.vibrate([0n, 43n], -1);
}

export async function model(): Promise<string> {
  return Looper.myLooper() === Looper.getMainLooper() ? "main" : (Build.MODEL ?? "unknown");
}
`,
};
