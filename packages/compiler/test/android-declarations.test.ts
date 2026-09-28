import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { sdkAvailable } from "@lucent-lang/bindgen";
import { compile } from "../src/index.ts";

/** Android output for a platform module whose Android side is `src` (exporting run()). */
function android(src: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-declarations-"));
  const files = {
    "m.lucent.ts": "export declare function run(): Promise<string>;\n",
    "m.ios.lucent.ts": 'export async function run(): Promise<string> {\n  return "";\n}\n',
    "m.android.lucent.ts": src,
  };

  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  return compile(
    Object.keys(files).map((f) => path.join(dir, f)),
    { platforms: ["android"] },
  );
}

const codes = (r: { diagnostics: { code: string; message: string }[] }) =>
  r.diagnostics.map((d) => `${d.code} ${d.message.split("\n")[0]}`);

describe.skipIf(!sdkAvailable("android"))("Android declarations Lucent code relies on", () => {
  it("shows the platform's BiometricPrompt from the Activity in front", () => {
    const r = android(`import {
  BiometricManager_Authenticators as Authenticators,
  BiometricPrompt_AuthenticationCallback,
  BiometricPrompt_AuthenticationResult,
  BiometricPrompt_Builder,
} from "lucent:android/android.hardware.biometrics";
import { CancellationSignal } from "lucent:android/android.os";
import { available, currentActivity } from "lucent:android";
import { main } from "lucent:thread";

/** An abstract SDK class with a public constructor: Lucent code extends it. */
class Answer extends BiometricPrompt_AuthenticationCallback {
  constructor(private readonly settle: (error: string | null) => void) {
    super();
  }

  onAuthenticationSucceeded(result: BiometricPrompt_AuthenticationResult | null): void {
    this.settle(null);
  }

  onAuthenticationError(code: number, message: string | null): void {
    this.settle(\`\${code}\`);
  }
}

export async function run(): Promise<string> {
  return new Promise<string>((resolve) => {
    void main(() => {
      if (!available("android", 30)) return resolve("old");

      const activity = currentActivity();
      if (!activity) return resolve("no activity");

      // An Activity is a Context.
      const prompt = new BiometricPrompt_Builder(activity)
        .setTitle("Sign in")
        ?.setAllowedAuthenticators(Authenticators.BIOMETRIC_WEAK | Authenticators.DEVICE_CREDENTIAL)
        ?.build();
      const executor = activity.getMainExecutor();
      if (!prompt || !executor) return resolve("no prompt");

      prompt.authenticate(new CancellationSignal(), executor, new Answer((e) => resolve(e ?? "ok")));
    });
  });
}
`);

    expect(codes(r)).toEqual([]);
    const java = [...(r.java ?? new Map()).values()].join("\n");
    expect(java).toContain(
      "extends android.hardware.biometrics.BiometricPrompt.AuthenticationCallback {",
    );
  });

  it("reads a property a class's superclass and interface give two ways", () => {
    const r = android(`import { FrameLayout } from "lucent:android/android.widget";
import { currentActivity } from "lucent:android";
import { main } from "lucent:thread";

export async function run(): Promise<string> {
  return new Promise<string>((resolve) => {
    void main(() => {
      const activity = currentActivity();
      if (!activity) return resolve("no activity");

      // View's getLayoutDirection, which ViewParent's is too.
      resolve(\`\${new FrameLayout(activity).layoutDirection}\`);
    });
  });
}
`);

    expect(codes(r)).toEqual([]);
    expect(r.files.get("android/m_m.cpp")).toContain('"getLayoutDirection"');
  });

  it("extends an abstract SDK class through its public constructor", () => {
    const r = android(`import { ActionMode_Callback2 } from "lucent:android/android.view";

class Menu extends ActionMode_Callback2 {}

export async function run(): Promise<string> {
  return \`\${new Menu() !== null}\`;
}
`);

    expect(codes(r)).toEqual([]);
  });
});
