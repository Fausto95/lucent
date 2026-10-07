import { describe, expect, it } from "vite-plus/test";
import { messages, one } from "./fixture.ts";

describe("main-thread setup", () => {
  it("accepts main-thread native code and calls of event props, in setup and handlers", () => {
    const a = one(`import { Label } from "./native";

type Props = { title: string; onTap?: (count: number) => void };

export function Button(props: Props): Label {
  const label = new Label();
  let taps = 0;
  label.text = props.title;
  label.onTap(() => {
    taps++;
    props.onTap?.(taps);
  });
  return label;
}
`);

    expect(a.diagnostics).toEqual([]);
    expect(a.components.map((c) => c.id)).toEqual(["@acme/app/m#Button"]);
  });

  it("refuses module state, which the module's own thread owns, with the path to it", () => {
    const a = one(`import { Label } from "./native";

let made = 0;

export function madeSoFar(): number {
  return made;
}

function count(): number {
  made++;
  return made;
}

export function Counter(props: { step: number }): Label {
  const label = new Label();
  label.text = String(count());
  return label;
}
`);

    expect(a.components).toEqual([]);
    expect(messages(a, "LUCENT3022")).toEqual([
      "`Counter` cannot run on the main thread: it calls `count` (m.lucent.tsx:16:23), which reads module state `made`, a `let` (declared at m.lucent.tsx:3:5) (m.lucent.tsx:10:3). It is not the main thread's alone: `madeSoFar` (m.lucent.tsx:6:10) uses it too.",
    ]);
    expect(a.diagnostics[0]!.fix).toMatch(/module's thread/);
  });

  it("checks the handlers a component gives native code", () => {
    const a = one(`import { Disk, Label } from "./native";

export function Reader(props: { path: string }): Label {
  const label = new Label();
  label.onTap(() => {
    label.text = Disk.read(props.path);
  });
  return label;
}
`);

    expect(messages(a, "LUCENT3022")).toEqual([
      "`the closure in Reader` cannot run on the main thread: it calls `Disk.read`, which must run off the main thread (m.lucent.tsx:6:18).",
      "`the closure in Reader` cannot run on the main thread: it calls `Disk.read` (m.lucent.tsx:6:18).",
    ]);
  });

  it("refuses an event prop called through an alias: the compiler cannot follow it", () => {
    const a = one(`import { Label } from "./native";

export function Alias(props: { onTap: () => void }): Label {
  const tap = props.onTap;
  tap();
  return new Label();
}
`);

    expect(messages(a, "LUCENT3022")).toHaveLength(1);
    expect(messages(a, "LUCENT3022")[0]).toMatch(
      /^`Alias` cannot run on the main thread: it calls `tap`/,
    );
  });

  it("checks functions given to expose by name", () => {
    const a = one(`import { Label } from "./native";
import { expose } from "./ui";

let bumps = 0;

export function bumped(): number {
  return bumps;
}

function bump(): void {
  bumps++;
}

export function Bumper(props: { value: number }): Label {
  expose({ bump });
  return new Label();
}
`);

    expect(messages(a, "LUCENT3022")).toEqual([
      "`bump` cannot run on the main thread: it reads module state `bumps`, a `let` (declared at m.lucent.tsx:4:5) (m.lucent.tsx:11:3). It is not the main thread's alone: `bumped` (m.lucent.tsx:7:10) uses it too.",
    ]);
  });

  it("accepts commands that only convert values, and still refuses module state", () => {
    const a = one(`import { Label } from "./native";
import { expose } from "./ui";

let total = 0;

export function totalSoFar(): number {
  return total;
}

export function Ticker(props: { start: number }): Label {
  const label = new Label();
  expose({
    show: (n: number) => {
      label.text = (BigInt(n) + BigInt.asIntN(64, 1n)).toString(16) + [n].toString();
    },
    add: (n: number) => {
      label.text = String(BigInt(total + n));
    },
  });
  return label;
}
`);

    expect(messages(a, "LUCENT3022")).toEqual([
      "`add` cannot run on the main thread: it reads module state `total`, a `let` (declared at m.lucent.tsx:4:5) (m.lucent.tsx:17:34). It is not the main thread's alone: `totalSoFar` (m.lucent.tsx:7:10) uses it too.",
    ]);
  });

  it("reports a cause once, not in every function that reaches it", () => {
    const a = one(`import { Disk, Label } from "./native";

export function Reader(props: { path: string }): Label {
  const read = () => Disk.read(props.path);
  const label = new Label();
  label.text = read();
  return label;
}
`);

    expect(messages(a, "LUCENT3022")).toHaveLength(2);
  });
});
