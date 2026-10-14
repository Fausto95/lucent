import { ts as js } from "@lucent-lang/codegen";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import { runtimeDir } from "../../src/index.ts";
import { componentDeclarations, componentExports, VIEWS_RUNTIME } from "../../src/ui/proxy.ts";
import { views } from "./fixture.ts";
import { components, instanceComponents, SOURCE } from "./views-fixture.ts";

const ROOT = path.resolve(import.meta.dirname, "../../../..");

/** The fixture module's component exports, as its proxy (js/ui.js) prints them. */
const exportsText = () =>
  js.printUnit({
    decls: [js.stmt(js.exprStmt(js.str("use strict"))), ...componentExports(components(), "./")],
  });

const declarationsText = () => js.printUnit(componentDeclarations(components()));

describe("component exports", () => {
  it("make each component from its description, with the app's React and React Native", () => {
    const text = exportsText();

    expect(text).toContain(`const { lucentComponent } = require("./${VIEWS_RUNTIME}");`);
    expect(text).toMatch(/^exports\.Caption = lucentComponent\(\{$/m);
    expect(text).toContain('}, require("react"), require("react-native"));');
  });

  it("send props and handlers under transport keys, boxing only what holds null", () => {
    const text = exportsText();

    expect(text).toContain('{ name: "text", key: "p0", shape: 0 },');
    expect(text).toContain('{ name: "detail", key: "p1", shape: { n: 0 } },');
    expect(text).toContain(
      '{ name: "points", key: "p3", shape: { a: { o: [{ name: "y", shape: { n: 0 } }] } } },',
    );
    expect(text).toContain('{ name: "tags", key: "p4", shape: { a: { n: 0 } } },');
    expect(text).toContain('{ name: "onChange", key: "e0", event: "topLucent0" },');
    expect(text).toContain('{ name: "sample", request: true, params: [0] },');
  });

  it("say which components take React children", () => {
    const text = exportsText();

    expect(text).toMatch(/displayName: "Card",\n\s*children: true,/);
    expect(text.match(/children: true/g)).toHaveLength(1);
    expect(declarationsText()).toContain(
      'export declare function Card(props: Omit<ViewProps, "children" | "title"> & { title: string; children?: ReactNode; ref?: Ref<HostInstance> }): ReactNode;',
    );
  });

  it("declare React components: props, callbacks, React Native's view props, and a ref to the host view with the commands", () => {
    const text = declarationsText();

    expect(text).toContain(
      'export declare function Caption(props: Omit<ViewProps, "children" | "text" | "detail"> & { text: string; detail?: string | null; ref?: Ref<HostInstance> }): ReactNode;',
    );
    expect(text).toContain('"aria-label"?: string;');
    expect(text).toContain("onChange?: (value: number, source?: string) => void;");
    expect(text).toContain(
      'ref?: Ref<HostInstance & { reset: () => void; sample: (unit: "pt" | "px", options?: { signal?: AbortSignal }) => Promise<number>; flush: (options?: { signal?: AbortSignal }) => Promise<void> }>',
    );
  });

  it("refuse a command named as a member the host view's ref has, but focus and blur", () => {
    for (const taken of ["measure", "measureLayout", "children", "__nativeTag"]) {
      const { diagnostics } = views({
        "ui.lucent.tsx": SOURCE.replace("sample: (unit", `${taken}: (unit`),
      });
      expect(diagnostics.map((d) => `${d.code} ${d.message}`)).toContain(
        `LUCENT3021 \`Gauge\`'s command \`${taken}\` takes the name of a member the host view's ref has: rename it`,
      );
    }

    const { diagnostics } = views({
      "ui.lucent.tsx": SOURCE.replace("sample: (unit", "focus: (unit"),
    });
    expect(diagnostics).toEqual([]);
  });

  it("match the reviewed output", async () => {
    await expect(exportsText()).toMatchFileSnapshot("__snapshots__/proxy/ui.js.snap");
    await expect(declarationsText()).toMatchFileSnapshot("__snapshots__/proxy/ui.d.ts.snap");
  });

  it("are the same on every run", () => {
    expect(exportsText()).toBe(exportsText());
    expect(declarationsText()).toBe(declarationsText());
  });
});

const APP = `import { type ComponentRef, useRef } from "react";
import { findNodeHandle } from "react-native";
import { Card, Caption, Gauge } from "./ui";

type GaugeRef = ComponentRef<typeof Gauge>;

export function App() {
  const gauge = useRef<GaugeRef>(null);

  return (
    <>
      <Caption text="Speed" detail={null} />
      <Caption text="Speed" />
      <Gauge
        ref={gauge}
        value={1}
        mode="linear"
        points={[{ x: 1, y: null }, { x: 2 }]}
        tags={["a", null]}
        aria-label="speed"
        onChange={(value, source) => console.log(value.toFixed(1), source?.length)}
        onReset={() => gauge.current?.reset()}
        style={{ height: 80 }}
        testID="gauge"
        accessibilityLabel="Speed"
        onLayout={(e) => console.log(e.nativeEvent.layout.width)}
      />
      <Card title="Trip">
        <Caption text="Inside" />
        {null}
        text
      </Card>
      <Card title="Empty" />
    </>
  );
}

export async function sample(gauge: GaugeRef): Promise<number> {
  await gauge.flush();
  gauge.measure((x, y, width) => console.log(x, y, width));
  // The host view's own ref, which what finds views by their refs takes.
  console.log(findNodeHandle(gauge), gauge.getBoundingClientRect().width);

  return gauge.sample("px", { signal: AbortSignal.timeout(1000) });
}
`;

const MISUSE = `import { useRef } from "react";
import { Caption, Gauge } from "./ui";

export const wrongType = <Gauge value="1" mode="linear" points={[]} onReset={() => {}} />;

export const missing = <Gauge value={1} points={[]} onReset={() => {}} />;

export function OtherRef() {
  const gauge = useRef<{ nope(): void }>(null);

  return <Gauge ref={gauge} value={1} mode="linear" points={[]} onReset={() => {}} />;
}

export const childless = (
  <Caption text="Outside">
    <Caption text="Inside" />
  </Caption>
);
`;

/**
 * TypeScript's errors for `files`, with React 19's and the example app's
 * React Native types; `paths` maps more modules to files among them.
 */
function typeErrors(files: Record<string, string>, paths: Record<string, string> = {}): string[] {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-proxy-"));

  for (const [name, text] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }

  const react = path.join(ROOT, "node_modules/@types/react");
  const program = ts.createProgram({
    rootNames: Object.keys(files)
      .filter((f) => /\.(tsx|js)$/.test(f) && !f.startsWith("_lucent/"))
      .map((f) => path.join(dir, f)),
    options: {
      strict: true,
      noEmit: true,
      allowJs: true,
      checkJs: true,
      jsx: ts.JsxEmit.ReactJSX,
      module: ts.ModuleKind.ESNext,
      moduleResolution: ts.ModuleResolutionKind.Bundler,
      target: ts.ScriptTarget.ES2022,
      skipLibCheck: true,
      types: [],
      paths: {
        react: [path.join(react, "index.d.ts")],
        "react/*": [path.join(react, "*")],
        "react-native": [
          path.join(ROOT, "apps/bare-example/node_modules/react-native/types_generated/index.d.ts"),
        ],
        ...Object.fromEntries(
          Object.entries(paths).map(([spec, file]) => [spec, [path.join(dir, file)]]),
        ),
      },
    },
  });

  const errors = ts
    .getPreEmitDiagnostics(program)
    .map((d) => ts.flattenDiagnosticMessageText(d.messageText, "\n"));

  fs.rmSync(dir, { recursive: true, force: true });

  return errors;
}

describe("a module's proxy and declarations", () => {
  const files = () => ({
    "ui.js": exportsText(),
    "ui.d.ts": declarationsText(),
    [VIEWS_RUNTIME]: fs.readFileSync(path.join(runtimeDir(), "js/views.js"), "utf8"),
    [VIEWS_RUNTIME.replace(/\.js$/, ".d.ts")]: fs.readFileSync(
      path.join(runtimeDir(), "js/views.d.ts"),
      "utf8",
    ),
  });

  it("type-check with React Native's types, and so does an app using them", () => {
    expect(typeErrors({ ...files(), "app.tsx": APP })).toEqual([]);
  }, 60_000);

  it("reject props and refs of other types", () => {
    const errors = typeErrors({ ...files(), "wrong.tsx": MISUSE }).join("\n");

    expect(errors).toMatch(/Type 'string' is not assignable to type 'number'/);
    expect(errors).toMatch(/Property 'mode' is missing/);
    expect(errors).toMatch(/nope/);
    expect(errors).toMatch(/'children' does not exist/);
  }, 60_000);
});

const PLAYERS_APP = `import { Player } from "lucent:module/players";
import { PlayerView } from "./players";

const a = new Player("a");

export const shown = <PlayerView player={a} next={null} queue={[a, new Player("b")]} />;
`;

const PLAYERS_MISUSE = `import { PlayerView } from "./players";

// An object with a Player's fields passes TypeScript, and the views runtime refuses it at render.
export const notAPlayer = <PlayerView player="a" queue={[]} />;
`;

describe("a component taking instances", () => {
  const exported = () =>
    js.printUnit({
      decls: [
        js.stmt(js.exprStmt(js.str("use strict"))),
        ...componentExports(instanceComponents(), "./"),
      ],
    });
  const declared = () => js.printUnit(componentDeclarations(instanceComponents()));

  it("sends each instance as its id, alone, boxed or in an array", () => {
    const text = exported();

    expect(text).toContain(
      '{ name: "player", key: "p0", shape: { i: "players.Player", c: "Player" } },',
    );
    expect(text).toContain(
      '{ name: "next", key: "p1", shape: { n: { i: "players.Player", c: "Player" } } },',
    );
    expect(text).toContain(
      '{ name: "queue", key: "p2", shape: { a: { i: "players.Player", c: "Player" } } },',
    );
  });

  it("types each as its class, from its module's own exports", () => {
    const text = declared();

    expect(text).toContain('import type { Player } from "lucent:module/players";');
    expect(text).toContain("player: Player; next?: Player | null; queue: Player[];");
  });

  const files = () => ({
    "players.js": exported(),
    "players.d.ts": declared(),
    // What `lucent build` writes for the module: its own exports, here declared.
    "module/players.d.ts": `export declare class Player {
  readonly title: string;
  constructor(title: string);
}
`,
    [VIEWS_RUNTIME]: fs.readFileSync(path.join(runtimeDir(), "js/views.js"), "utf8"),
    [VIEWS_RUNTIME.replace(/\.js$/, ".d.ts")]: fs.readFileSync(
      path.join(runtimeDir(), "js/views.d.ts"),
      "utf8",
    ),
  });
  const paths = { "lucent:module/players": "module/players.d.ts" };

  it("type-check with an app passing instances, and refuse other values", () => {
    expect(typeErrors({ ...files(), "app.tsx": PLAYERS_APP }, paths)).toEqual([]);
    expect(typeErrors({ ...files(), "wrong.tsx": PLAYERS_MISUSE }, paths).join("\n")).toMatch(
      /Type 'string' is not assignable to type 'Player'/,
    );
  }, 60_000);
});
