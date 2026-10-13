// Instance props (T120, decision 0098), mounted on Mac Catalyst (UIKit) the
// way a platform host mounts them, against React Native's prebuilt
// renderer: view_ref_props_run_test.mm drives them.
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runtimeDir } from "../../src/index.ts";
import { canRunMounted, runMounted } from "./mount-harness.ts";

const PROPS = "{ player: Player; next?: Player | null; queue: Player[] }";

/** A player JavaScript makes, and a label showing one, the one after it, and a queue of them. */
const FILES = {
  "player.lucent.ts": `export class Player {
  readonly title: string;

  constructor(title: string) {
    this.title = title;
  }
}
`,
  "view.lucent.ts": `import type { UILabel } from "lucent:ios/UIKit";
import type { TextView } from "lucent:android/android.widget";
import type { Player } from "./player.lucent";

export declare function PlayerView(props: ${PROPS}): UILabel | TextView;
`,
  "view.ios.lucent.tsx": `import { UILabel } from "lucent:ios/UIKit";
import { effect } from "lucent:ui";
import type { Player } from "./player.lucent";

export function PlayerView(props: ${PROPS}): UILabel {
  const label = new UILabel();

  effect(() => {
    const queue = props.queue.map((p) => p.title).join(",");

    label.text = \`\${props.player.title} next \${props.next?.title ?? "none"} queue \${queue}\`;
  });

  return label;
}
`,
};

/** Every step of the driver, in order. */
const EXPECTED = [
  "set: a next none queue a,b",
  "replaced: b next none queue a,b",
  "next set: b next c queue a,b",
  "next nulled: b next none queue a,b",
  // The commit and the mount hold what JavaScript let go of.
  "a let go: held, b next none queue a,b",
  "a gone from the queue: freed, b next none queue b",
  "a freed player's id: b next none queue b",
  "a torn-down runtime's id: b next none queue b",
  "unmounted: players freed, native references all released",
  "1000 mounts: 0 players held, native references all released, ids swept",
];

describe("instance props, mounted", () => {
  it.skipIf(!canRunMounted)(
    "are set, replaced, nulled and freed, held by the commits and the mount that have them",
    () => {
      expect(
        runMounted(FILES, "view_ref_props_run_test.mm", {
          includePaths: [],
          sources: [path.join(runtimeDir(), "cpp/rn/LucentViewInstances.cpp")],
        }),
      ).toEqual(EXPECTED);
    },
    600_000,
  );
});
