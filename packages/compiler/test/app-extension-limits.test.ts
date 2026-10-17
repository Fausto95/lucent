/**
 * What app extensions can't use (decision 0124): in every module an app
 * extension's code reaches through its imports, an SDK member bindgen
 * marked unavailable to app extensions, or a declaration of Lucent's own
 * tagged `@extensionUnavailable`, is refused (LUCENT3018); a module the
 * extension's declaration names that isn't one is LUCENT3019. Compiled
 * against a schema set, on any machine.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { compile, sdkAvailable } from "../src/index.ts";
import { symbolGraph } from "../../bindgen/src/ios.ts";
import { loadSdkModule } from "../src/sdk/schema.ts";
import { schemaSet } from "./schema-set.ts";

const KIT = {
  module: "Kit",
  header: "Kit/Kit.h",
  types: [
    {
      kind: "class",
      name: "KITApp",
      native: "KITApp",
      properties: [
        {
          name: "shared",
          type: "Kit.KITApp",
          static: true,
          readonly: true,
          extensionUnavailable: true,
        },
        { name: "title", type: "string", readonly: true },
      ],
      methods: [
        { name: "open", params: [], returns: "void", selector: "open", extensionUnavailable: true },
        { name: "ping", params: [], returns: "void", selector: "ping" },
      ],
    },
    {
      kind: "class",
      name: "KITStatusBar",
      native: "KITStatusBar",
      constructors: [{ params: [], selector: "init" }],
      extensionUnavailable: true,
    },
    {
      kind: "class",
      name: "KITService",
      native: "KITService",
      constructors: [{ params: [], selector: "init" }],
    },
  ],
};

const set = schemaSet([KIT]);

/** A package `lucent-push` with these files and an app extension naming `code`, compiled for iOS. */
function build(files: Record<string, string>, code = "push#Rich") {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-ext-limits-"));
  const all: Record<string, string> = {
    "package.json": '{ "name": "lucent-push", "version": "1.0.0", "lucent": {} }\n',
    "lucent.json": JSON.stringify({
      ios: { appExtensions: [{ kind: "notificationService", name: "RichPush", class: code }] },
    }),
    ...files,
  };
  for (const [name, text] of Object.entries(all)) fs.writeFileSync(path.join(dir, name), text);

  const r = compile(
    Object.keys(all)
      .filter((f) => f.endsWith(".lucent.ts"))
      .map((f) => path.join(dir, f)),
    {
      platforms: ["ios"],
      sdk: {
        schemas: set,
        cacheDir: path.join(dir, "cache"),
        ios: { xcrun: path.join(dir, "no-xcrun") },
      },
    },
  );
  return r.diagnostics.map((d) => `${d.code} ${d.message}`);
}

/** A platform module: its shared declaration, and its iOS file. */
const module = (name: string, declared: string, ios: string) => ({
  [`${name}.lucent.ts`]: declared,
  [`${name}.ios.lucent.ts`]: ios,
});

describe("an app extension's code", () => {
  it("can't use what the SDK marks unavailable to app extensions, in a module it reaches", () => {
    const messages = build({
      ...module(
        "push",
        "export declare function badge(): string;\n",
        `import { KITService } from "lucent:ios/Kit";
import { title } from "./shared.lucent";

export class Rich extends KITService {}

export function badge(): string {
  return title();
}
`,
      ),
      ...module(
        "shared",
        "export declare function title(): string;\n",
        `import { KITApp, KITStatusBar } from "lucent:ios/Kit";

export function title(): string {
  const app = KITApp.shared;
  app.open();
  app.ping();
  new KITStatusBar();
  return app.title;
}
`,
      ),
      // Not imported by the extension's code: the app's alone.
      ...module(
        "app",
        "export declare function open(): void;\n",
        `import { KITApp } from "lucent:ios/Kit";

export function open(): void {
  KITApp.shared.open();
}
`,
      ),
    });

    const of = "is code of the app extension RichPush";
    expect(messages).toEqual(
      expect.arrayContaining([
        `LUCENT3018 KITApp.shared is unavailable in app extensions, and lucent-push/shared ${of}`,
        `LUCENT3018 KITApp.open is unavailable in app extensions, and lucent-push/shared ${of}`,
        `LUCENT3018 KITStatusBar is unavailable in app extensions, and lucent-push/shared ${of}`,
      ]),
    );
    expect(messages.join("\n")).not.toMatch(/ping|title is unavailable|lucent-push\/app /);
    expect(messages.every((m) => m.startsWith("LUCENT3018"))).toBe(true);
  });

  it("can't use Lucent's own APIs that need the app", () => {
    const messages = build(
      module(
        "push",
        "export declare function watch(): void;\n",
        `import { KITService } from "lucent:ios/Kit";
import { onAppEvent } from "lucent:ios";

export class Rich extends KITService {}

export function watch(): void {
  onAppEvent("didBecomeActive", () => {});
}
`,
      ),
    );

    expect(messages).toEqual([
      "LUCENT3018 onAppEvent() is unavailable in app extensions, and lucent-push/push is code of the app extension RichPush",
    ]);
  });

  it("compiles when it uses what app extensions can", () => {
    expect(
      build(
        module(
          "push",
          "export declare function ping(): void;\n",
          `import { KITService } from "lucent:ios/Kit";

export class Rich extends KITService {}

export function ping(): void {
  new Rich();
}
`,
        ),
      ),
    ).toEqual([]);
  });

  it("names a module of its package, or the build fails", () => {
    expect(
      build(
        module(
          "push",
          "export declare function ping(): void;\n",
          "export function ping(): void {}\n",
        ),
        "rich#Rich",
      ),
    ).toEqual([
      "LUCENT3019 lucent.json's ios.appExtensions RichPush names rich#Rich, but lucent-push has no module lucent-push/rich",
    ]);
  });
});

// What the iOS SDK marks (NS_EXTENSION_UNAVAILABLE_IOS), as its symbol graph says: LUCENT3018's
// explanation refuses UIApplication.shared in an app extension's code.
describe.skipIf(!sdkAvailable("ios"))("the iOS SDK's APIs app extensions can't use", () => {
  it("are marked in its schema, UIApplication.shared among them", () => {
    const app = loadSdkModule("ios", "UIKit").types.find((t) => t.name === "UIApplication");
    const shared =
      app?.kind === "class" ? app.properties?.find((p) => p.name === "shared") : undefined;

    // On a failure, the property's symbol in UIKit's symbol graph, with its availability.
    const graphed = () => {
      const sdk = spawnSync("xcrun", ["--sdk", "iphonesimulator", "--show-sdk-path"], {
        encoding: "utf8",
      }).stdout.trim();
      const g = symbolGraph("UIKit", { modules: ["UIKit"] }, sdk);
      const symbol = (shared?.symbol ?? "").replace(/^objc:/, "");
      const found = g.symbols.find((x) => x.identifier.precise === symbol);
      return JSON.stringify(found ? { availability: found.availability } : `no ${symbol}`);
    };
    expect(
      shared?.extensionUnavailable,
      shared?.extensionUnavailable ? "" : `${JSON.stringify(shared)}\n${graphed()}`,
    ).toBe(true);
  }, 600_000);
});
