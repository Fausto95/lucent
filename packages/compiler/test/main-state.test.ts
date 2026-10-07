import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { compile } from "../src/index.ts";

const ios = process.platform === "darwin";

/**
 * expo-video's shape: a class JavaScript makes, whose native object lives
 * on the main thread in a map only main-thread code uses, and a view that
 * shows the one its prop names.
 */
const PLAYERS = `import { UILabel } from "lucent:ios/UIKit";
import { PLATFORM } from "lucent:platform";
import { main } from "lucent:thread";
import { effect } from "lucent:ui";

const labels = new Map<number, UILabel>();
let next = 0;

export class Player {
  readonly id = next++;

  constructor(title: string) {
    const id = this.id;

    if (PLATFORM === "ios")
      void main(() => {
        const label = new UILabel();
        label.text = title;
        labels.set(id, label);
      });
  }

  [Symbol.dispose](): void {
    const id = this.id;

    if (PLATFORM === "ios") void main(() => labels.delete(id));
  }
}

export function Screen(props: { player: number }) {
  if (PLATFORM === "ios") {
    const label = new UILabel();
    effect(() => {
      label.text = labels.get(props.player)?.text ?? "none";
    });
    return label;
  }
  throw new Error("ios only");
}
`;

function compileApp(source: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-main-state-"));

  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
  fs.writeFileSync(path.join(dir, "video.lucent.tsx"), source);

  return compile([path.join(dir, "video.lucent.tsx")], { platforms: ["ios"] });
}

/** The messages of the main-thread refusals. */
function refusals(source: string): string[] {
  return compileApp(source)
    .diagnostics.filter((d) => d.code === "LUCENT3022")
    .map((d) => d.message);
}

describe.skipIf(!ios)("state only the main thread uses", () => {
  const views = process.env.LUCENT_VIEWS;

  beforeAll(() => {
    process.env.LUCENT_VIEWS = "fabric";
  });

  afterAll(() => {
    if (views === undefined) delete process.env.LUCENT_VIEWS;
    else process.env.LUCENT_VIEWS = views;
  });

  it("is read by a view and written by main() callbacks", () => {
    expect(compileApp(PLAYERS).diagnostics).toEqual([]);
  }, 180_000);

  it("is assigned on the main thread when the module is initialized", () => {
    const native = [...compileApp(PLAYERS).files.values()].join("\n");
    const init = native.slice(native.indexOf("::init() {"));

    expect(init).toMatch(/postToMain\(\[[^\]]*\]\s*\(\)\s*\{[^}]*labels = /);
  }, 180_000);

  it("is module state again once module code uses it", () => {
    const source = PLAYERS.replace(
      "export function Screen",
      'export function count(): number {\n  if (PLATFORM === "ios") return labels.size;\n  return 0;\n}\n\nexport function Screen',
    );

    expect(refusals(source)).toEqual([
      expect.stringMatching(
        /reads module state `labels`.*`count` \(video\.lucent\.tsx:\d+:\d+\) uses it too/,
      ),
    ]);
  }, 180_000);

  it("is module state when main-thread code lets the map itself out", () => {
    const source = PLAYERS.replace(
      "labels.set(id, label);",
      "labels.set(id, label);\n        return labels;",
    );

    expect(refusals(source)).toEqual([
      expect.stringMatching(
        /reads module state `labels`.*used as a value \(video\.lucent\.tsx:\d+:\d+\)/,
      ),
    ]);
  }, 180_000);

  it("is module state when it holds objects of its own", () => {
    const source = PLAYERS.replace(
      "new Map<number, UILabel>()",
      "new Map<number, { label: UILabel }>()",
    )
      .replace("labels.set(id, label);", "labels.set(id, { label });")
      .replace("labels.get(props.player)?.text", "labels.get(props.player)?.label.text");

    expect(refusals(source)).toEqual([
      expect.stringMatching(/reads module state `labels`.*holds `\{ label: UILabel; \}`/),
    ]);
  }, 180_000);

  it("is module state when its initial value is computed", () => {
    const source = PLAYERS.replace(
      "const labels = new Map<number, UILabel>();",
      "const labels = made();\n\nfunction made(): Map<number, UILabel> {\n  return new Map();\n}",
    );

    expect(refusals(source)).toEqual([
      expect.stringMatching(/reads module state `labels`.*initial value/),
    ]);
  }, 180_000);
});
