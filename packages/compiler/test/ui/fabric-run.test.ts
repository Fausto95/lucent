import { ts as js } from "@lucent-lang/codegen";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vite-plus/test";
import { runtimeDir } from "../../src/index.ts";
import { fabricSources } from "../../src/ui/fabric.ts";
import { componentExports, VIEWS_RUNTIME } from "../../src/ui/proxy.ts";
import { catalystToolchain } from "./react-native-headers.ts";
import { components, GAUGE } from "./views-fixture.ts";

type Props = Record<string, unknown>;

/**
 * The fixture's module proxy, run with the views runtime and just enough
 * React: renders Gauge's native view for React props, and gives its props
 * as React Native sends a function (true) or removes a prop (null).
 */
function proxyRenderer(): (props: Props) => Props {
  const text = js.printUnit({ decls: componentExports(components(), "./") });
  const views = { exports: {} as object };

  new Function(
    "module",
    "exports",
    fs.readFileSync(path.join(runtimeDir(), "js/views.js"), "utf8"),
  )(views, views.exports);

  const React = {
    createElement: (_type: unknown, props: Props) => props,
    useRef: (current: unknown) => ({ current }),
    useState: (init: () => unknown) => [init(), () => {}],
    useImperativeHandle: () => {},
    useEffect: () => {},
  };
  const ReactNative = {
    NativeComponentRegistry: { get: (name: string) => name },
    codegenNativeCommands: () => ({}),
  };
  const modules: Record<string, object> = {
    [`./${VIEWS_RUNTIME}`]: views.exports,
    react: React,
    "react-native": ReactNative,
  };
  const exported: Record<string, (props: Props) => Props> = {};

  new Function("exports", "require", text)(exported, (spec: string) => modules[spec]);

  return (props) => {
    const { ref: _ref, style: _style, ...host } = exported.Gauge!(props);

    return Object.fromEntries(
      Object.entries(host).map(([k, v]) => [k, typeof v === "function" ? true : v]),
    );
  };
}

/** What React sends the renderer for a commit: changed props, and null for removed ones. */
function payload(previous: Props, next: Props): Props {
  const out: Props = {};

  for (const [key, value] of Object.entries(next))
    if (JSON.stringify(previous[key]) !== JSON.stringify(value)) out[key] = value;

  for (const key of Object.keys(previous)) if (!(key in next)) out[key] = null;

  return out;
}

const onReset = () => {};
const onChange = () => {};

/** React props for each commit, and what the native props must then hold. */
const COMMITS: { props: Props; values: Props; handlers: number[]; changed: number[] }[] = [
  {
    props: {
      value: 1,
      mode: "linear",
      points: [{ x: 1, y: null }, { x: 2, y: 3 }, { x: 4 }],
      tags: ["a", null],
      onReset,
    },
    values: {
      value: 1,
      mode: "linear",
      points: [{ x: 1, y: null }, { x: 2, y: 3 }, { x: 4 }],
      tags: ["a", null],
    },
    handlers: [1],
    changed: [0, 2, 3, 4],
  },
  {
    props: {
      value: 1,
      enabled: true,
      mode: "linear",
      points: [{ x: 1, y: null }, { x: 2, y: 3 }, { x: 4 }],
      tags: ["a", null],
      "aria-label": "speed",
      onChange,
      onReset,
    },
    values: {
      value: 1,
      enabled: true,
      mode: "linear",
      points: [{ x: 1, y: null }, { x: 2, y: 3 }, { x: 4 }],
      tags: ["a", null],
      "aria-label": "speed",
    },
    handlers: [0, 1],
    changed: [1, 5],
  },
  {
    props: { value: 1, mode: "radial", points: [], tags: undefined, onReset },
    values: { value: 1, mode: "radial", points: [] },
    handlers: [1],
    changed: [1, 2, 3, 4, 5],
  },
  {
    // Not a number: read as missing, and logged.
    props: { value: "fast", mode: "radial", points: [], onReset },
    values: { mode: "radial", points: [] },
    handlers: [1],
    changed: [0],
  },
];

const toolchain = catalystToolchain();

describe("a component's native props", () => {
  it.skipIf(!toolchain)(
    "hold what React committed: missing, null or the value, from JavaScript or dynamic",
    () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lucent-fabric-run-"));

      for (const [name, text] of fabricSources(components())) {
        fs.mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
        fs.writeFileSync(path.join(dir, name), text);
      }

      const binary = path.join(dir, "props_test");
      const build = spawnSync(
        toolchain!.command,
        [
          ...toolchain!.args,
          `-I${dir}`,
          path.join(import.meta.dirname, "fabric_props_test.cpp"),
          path.join(dir, `views/${GAUGE}.cpp`),
          path.join(runtimeDir(), "cpp/lucent/report.cpp"),
          "-o",
          binary,
        ],
        { encoding: "utf8" },
      );

      expect(build.stderr).toBe("");

      const render = proxyRenderer();
      let previous: Props = {};
      const lines = COMMITS.map((c) => {
        const next = render(c.props);
        const line = JSON.stringify(payload(previous, next));

        previous = next;
        return line;
      });

      const expected = COMMITS.map((c) => ({
        values: c.values,
        handlers: c.handlers,
        changed: c.changed,
      }));

      for (const mode of ["jsi", "dynamic"]) {
        const run = spawnSync(binary, [mode], { input: `${lines.join("\n")}\n`, encoding: "utf8" });
        const out = run.stdout
          .trim()
          .split("\n")
          .map((l) => JSON.parse(l) as unknown);

        expect(run.status).toBe(0);
        expect(out).toEqual(expected);
        expect(run.stderr).toContain(`[lucent] ${GAUGE} prop value: expected a number`);
      }

      fs.rmSync(dir, { recursive: true, force: true });
    },
    180_000,
  );
});
