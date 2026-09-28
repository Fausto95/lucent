import { ts as js } from "@lucent-lang/codegen";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vite-plus/test";
import { runtimeDir } from "../../src/index.ts";
import { componentDeclarations, componentExports, VIEWS_RUNTIME } from "../../src/ui/proxy.ts";
import { components } from "./views-fixture.ts";

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
    expect(text).toContain('{ name: "measure", request: true, params: [0] },');
  });

  it("say which components take React children", () => {
    const text = exportsText();

    expect(text).toMatch(/displayName: "Card",\n\s*children: true,/);
    expect(text.match(/children: true/g)).toHaveLength(1);
    expect(declarationsText()).toContain(
      "export declare function Card(props: { title: string; children?: ReactNode; style?: StyleProp<ViewStyle> }): ReactNode;",
    );
  });

  it("declare React components: props, callbacks, style and a ref to the commands", () => {
    const text = declarationsText();

    expect(text).toContain(
      "export declare function Caption(props: { text: string; detail?: string | null; style?: StyleProp<ViewStyle> }): ReactNode;",
    );
    expect(text).toContain('"aria-label"?: string;');
    expect(text).toContain("onChange?: (value: number, source?: string) => void;");
    expect(text).toContain(
      'ref?: Ref<{ reset: () => void; measure: (unit: "pt" | "px") => Promise<number>; flush: () => Promise<void> }>',
    );
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

const APP = `import { useRef } from "react";
import { Card, Caption, Gauge } from "./ui";

type GaugeRef = { reset(): void; measure(unit: "pt" | "px"): Promise<number>; flush(): Promise<void> };

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

export async function measure(gauge: GaugeRef): Promise<number> {
  await gauge.flush();

  return gauge.measure("px");
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

/** TypeScript's errors for `files`, with React 19's and the example app's React Native types. */
function typeErrors(files: Record<string, string>): string[] {
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
