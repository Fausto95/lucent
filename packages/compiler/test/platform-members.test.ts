import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../src/index.ts";
import { fakeAndroid } from "./fake-android.ts";
import { jdk, jvmRun } from "./jni-harness.ts";

/*
 * A private member of a shared class that uses one platform's code belongs
 * to that platform: the class compiles on both, and each build leaves out
 * the other platform's members. Android code compiles against stand-ins
 * and runs on the desktop JNI host; iOS code is untyped without Xcode.
 */

const standIns = {
  "android/media/MediaPlayer.java": `package android.media;
public class MediaPlayer {
  private boolean playing;
  public void start() { playing = true; }
  public void pause() { playing = false; }
  public boolean isPlaying() { return playing; }
}
`,
};

const imports = `import { PLATFORM } from "lucent:platform";
import { AVPlayer } from "lucent:ios/AVFoundation";
import { MediaPlayer } from "lucent:android/android.media";
`;

const player = `${imports}
export class Player {
  private ios: AVPlayer | null = null;
  private android: MediaPlayer | null = null;
  readonly name: string;

  constructor(name: string) {
    this.name = name;
  }

  play(): void {
    if (PLATFORM === "ios") this.ios?.play();
    else this.media().start();
  }

  get playing(): boolean {
    return PLATFORM === "ios" ? (this.ios?.rate ?? 0) > 0 : this.media().isPlaying();
  }

  // Android code: it uses an Android field.
  private media(): MediaPlayer {
    if (!this.android) this.android = new MediaPlayer();
    return this.android;
  }
}

export async function run(): Promise<string> {
  const a = new Player("a");
  const b = new Player("b");
  a.play();
  return \`\${a.name} \${a.playing} \${b.name} \${b.playing}\`;
}
`;

const android = fakeAndroid(fs.mkdtempSync(path.join(os.tmpdir(), "lucent-members-")), standIns);

/** A shared module `m.lucent.ts` compiled for `platforms`, against the stand-ins. */
function build(src: string, platforms: ("android" | "host")[]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-members-"));
  const file = path.join(dir, "m.lucent.ts");
  fs.writeFileSync(file, src);
  const r = compile([file], { platforms, sdk: { android: { jars: android!.bind } } });
  const shown = r.diagnostics.map((d) => `${d.code} ${d.line}: ${d.message}`);
  return { r, dir, shown };
}

describe.skipIf(!android)("platform members of a shared class", () => {
  it("compiles each platform's members in its own build only", () => {
    const { r, shown } = build(player, ["android", "host"]);
    expect(shown).toEqual([]);

    const header = r.files.get("android/lucent_app.h")!;
    const struct = header.slice(header.indexOf("struct C_Player :"));
    expect(struct).toContain("lucent::Opt<lucent::NativeRef> android{};");
    expect(struct).not.toMatch(/\bios\b/);
    expect(r.files.get("android/m_m.cpp")).toContain("C_Player::media()");

    const host = r.files.get("host/lucent_app.h")!;
    const hostStruct = host.slice(host.indexOf("struct C_Player :"));
    expect(hostStruct).not.toMatch(/\b(ios|android|media)\b/);
    expect(hostStruct).toContain("play()");
  });

  it("keeps a platform member's uses in that platform's code", () => {
    const { shown } = build(
      `${imports}
export class Player {
  private android: MediaPlayer | null = null;
  stop(): void {
    this.android?.pause();
  }
}
`,
      ["android"],
    );
    expect(shown).toEqual([
      'LUCENT3004 8: android uses lucent:android (Android code): use it inside `if (PLATFORM === "android")`, or in other Android code',
    ]);
  });

  it("refuses a member that uses both platforms, or a public one", () => {
    const { shown } = build(
      `${imports}
export class Player {
  media: MediaPlayer | null = null;
  private both(): string {
    return String(new MediaPlayer()) + String(new AVPlayer());
  }
}
`,
      ["android"],
    );
    expect(shown).toEqual([
      "LUCENT3004 7: Player.both uses lucent:ios and lucent:android outside a platform branch: branch with PLATFORM, or split it",
      'LUCENT3004 6: MediaPlayer comes from lucent:android/android.media (Android code): use it inside `if (PLATFORM === "android")`, or in other Android code',
    ]);
  });

  it("keeps a class with one platform's members that platform's", () => {
    const { shown } = build(
      `${imports}
class Holder {
  private media: MediaPlayer | null = null;
}

class Both {
  private ios: AVPlayer | null = null;
  private android: MediaPlayer | null = null;
}

export function make(): void {
  new Holder();
  new Both();
}
`,
      ["android"],
    );
    expect(shown).toEqual([
      'LUCENT3004 15: Holder uses lucent:android (Android code): use it inside `if (PLATFORM === "android")`, or in other Android code',
    ]);
  });

  it("refuses another platform's member in a platform's class", () => {
    const { shown } = build(
      `${imports}
class Holder {
  private ios: AVPlayer | null = null;
  start(): void {
    new MediaPlayer().start();
  }
}
`,
      ["android"],
    );
    expect(shown).toEqual([
      "LUCENT3004 6: Holder.ios is iOS code in a class that is Android code: export the class, or move the member's platform code into a branch",
    ]);
  });

  it.skipIf(!jdk)(
    "runs a class that keeps an Android object in a field",
    () => {
      const { r, dir, shown } = build(player, ["android"]);
      expect(shown).toEqual([]);
      expect(jvmRun(r, dir, android!.run)).toEqual({
        status: 0,
        stdout: "a true b false\n",
        stderr: "",
      });
    },
    300_000,
  );
});
