/**
 * Components whose iOS root is a UIKit view controller (T122): the setup
 * returns a `UIViewController`, such as AVKit's `AVPlayerViewController`,
 * and the mount gives the host the controller, which it contains as it
 * does a SwiftUI body's hosting controller, and the controller's view.
 * The host sizes it by its style or its preferred content size, and takes
 * the safe area back out of it (plainController). Compiled against a
 * schema set, on any machine.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile } from "../../src/index.ts";
import { schemaSet } from "../schema-set.ts";

const set = () =>
  schemaSet([
    {
      module: "UIKit",
      header: "UIKit/UIKit.h",
      types: [
        {
          kind: "class",
          name: "UIView",
          native: "UIView",
          constructors: [{ params: [], selector: "init" }],
        },
        {
          kind: "class",
          name: "UIViewController",
          native: "UIViewController",
          constructors: [{ params: [], selector: "init" }],
          properties: [{ name: "title", type: "string?", setter: "setTitle:" }],
        },
      ],
    },
    {
      module: "AVKit",
      header: "AVKit/AVKit.h",
      types: [
        {
          kind: "class",
          name: "AVPlayerViewController",
          native: "AVPlayerViewController",
          extends: "UIKit.UIViewController",
          constructors: [{ params: [], selector: "init" }],
          properties: [
            { name: "showsPlaybackControls", type: "bool", setter: "setShowsPlaybackControls:" },
          ],
        },
      ],
    },
  ]);

/** `files` compiled for iOS against the set alone (no SDK is read). */
function compiled(files: Record<string, string>) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-controller-roots-"));
  fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@acme/app" }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);

  return compile(
    Object.keys(files).map((f) => path.join(dir, f)),
    {
      platforms: ["ios"],
      sdk: {
        schemas: set(),
        cacheDir: path.join(dir, "cache"),
        ios: { xcrun: path.join(dir, "no-xcrun") },
      },
    },
  );
}

const PLAYER = {
  "player.lucent.ts": `import type { AVPlayerViewController } from "lucent:ios/AVKit";

export declare function Player(props: { controls: boolean }): AVPlayerViewController;
`,
  "player.ios.lucent.tsx": `import { AVPlayerViewController } from "lucent:ios/AVKit";
import { effect } from "lucent:ui";

export function Player(props: { controls: boolean }): AVPlayerViewController {
  const player = new AVPlayerViewController();
  effect(() => {
    player.showsPlaybackControls = props.controls;
  });
  return player;
}
`,
};

describe("a component whose iOS root is a UIKit view controller", () => {
  it("gives its host the controller, which it contains, and the controller's view", () => {
    const r = compiled(PLAYER);
    expect(r.diagnostics.map((d) => d.message)).toEqual([]);

    const view = [...r.files].find(([f]) => /views\/.*ComponentView\.mm$/.test(f))?.[1] ?? "";
    expect(view).toMatch(/bool plainController\(\) const override \{\s*return true;/);
    expect(view).toMatch(
      /UIViewController\s*\*\s*controller\(\) const override \{\s*return \(__bridge UIViewController\s*\*\)mount_->view\(\)\.get\(\);/,
    );
    expect(view).toMatch(/UIView\s*\*\s*view\(\) const override \{\s*return controller\(\)\.view;/);
  });

  it("refuses a setup returning a view on one path and a view controller on another", () => {
    const r = compiled({
      "either.lucent.ts": `import type { UIView, UIViewController } from "lucent:ios/UIKit";

export declare function Either(props: { plain: boolean }): UIView | UIViewController;
`,
      "either.ios.lucent.tsx": `import { UIView, UIViewController } from "lucent:ios/UIKit";

export function Either(props: { plain: boolean }): UIView | UIViewController {
  if (props.plain) return new UIView();
  return new UIViewController();
}
`,
    });

    expect(r.diagnostics.map((d) => [d.code, d.message])).toContainEqual([
      "LUCENT3020",
      "`Either` returns a view (`UIView`) or a view controller (`UIViewController`): a component's root is one kind on every path",
    ]);
  });
});
