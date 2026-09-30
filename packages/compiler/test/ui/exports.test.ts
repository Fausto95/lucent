import { describe, expect, it } from "vite-plus/test";
import { messages, one, views } from "./fixture.ts";

const TITLE = `import { Label } from "./native";

type Props = { title: string };

export function Title(props: Props): Label {
  const label = new Label();
  label.text = props.title;
  return label;
}

export function shout(s: string): string {
  return s.toUpperCase();
}
`;

describe("export classification", () => {
  it("describes an exported function returning a view as a component, and keeps other exports", () => {
    const a = one(TITLE, "title");

    expect(a.diagnostics).toEqual([]);
    expect(a.components.map((c) => c.id)).toEqual(["@acme/app/title#Title"]);
    expect([...a.declarations].map((d) => d.getText().split("(")[0])).toEqual([
      "export function Title",
    ]);
  });

  it("classifies by the view the function returns, inferred or declared, and arrow exports", () => {
    const a = one(`import { Label, View } from "./native";

export function Plain(): View {
  return new View();
}

export function Inferred(props: { on: boolean }) {
  if (props.on) return new Label();
  return new View();
}

export const Arrow = (props: { n: number }) => {
  const label = new Label();
  label.text = String(props.n);
  return label;
};

export function size(view: View): string {
  return view.title;
}
`);

    expect(a.diagnostics).toEqual([]);
    expect(a.components.map((c) => c.export)).toEqual(["Plain", "Inferred", "Arrow"]);
  });

  it("leaves .lucent.ts modules alone", () => {
    const a = views({ "title.lucent.ts": TITLE });

    expect(a.diagnostics).toEqual([]);
    expect(a.components).toEqual([]);
    expect(a.declarations.size).toBe(0);
  });

  it("diagnoses a return shape that is a view on some paths only", () => {
    const a = one(`import { Label } from "./native";

export function Maybe(props: { on: boolean }): Label | undefined {
  return props.on ? new Label() : undefined;
}
`);

    expect(a.components).toEqual([]);
    expect(messages(a, "LUCENT3020")).toEqual([
      "`Maybe` returns a view (`Label`) or another value (`undefined`): a component returns its view on every path; split it into a component and a function",
    ]);
  });

  it("diagnoses components that are async, generic, or take other than one props object", () => {
    const a = one(`import { Label } from "./native";

export async function Late(): Promise<Label> {
  return new Label();
}

export function Generic<T>(props: { value: T }): Label {
  return new Label();
}

export function Pair(a: { x: number }, b: { y: number }): Label {
  return new Label();
}

export function Text(title: string): Label {
  return new Label();
}
`);

    expect(messages(a, "LUCENT3020")).toEqual([
      "`Late` returns a promise of a view: a component sets up its view synchronously, and can start asynchronous work after it returns",
      "`Generic` has type parameters: a component's props have one concrete type",
      "`Pair` has 2 parameters: a component takes one props object, or none",
      "`Text` takes `string`: a component's parameter is its props object, such as `props: { title: string }`",
    ]);
    expect(a.components).toEqual([]);
  });

  it("diagnoses a component used as a value: its host mounts it", () => {
    const a = one(`${TITLE}
export function titled(): number {
  Title({ title: "again" });
  return 1;
}
`);

    expect(messages(a, "LUCENT3020")).toEqual([
      "`Title` is a component: React mounts it through its host, so Lucent code cannot call it or use it as a value",
    ]);
    expect(a.diagnostics[0]).toMatchObject({ line: 16, column: 3 });
  });

  it("needs a package name to identify a component", () => {
    const a = views({ "title.lucent.tsx": TITLE }, { pkg: null });

    expect(messages(a, "LUCENT3020")).toEqual([
      "`Title` needs a package to be identified by: add a package.json with a `name` next to its module or above it",
    ]);
  });

  it("does not read a malformed package.json as a name", () => {
    const a = views({ "title.lucent.tsx": TITLE }, { pkg: "{ name: " });

    expect(messages(a, "LUCENT3020")).toEqual([
      "`Title` needs a package to be identified by: add a package.json with a `name` next to its module or above it",
    ]);
  });

  it("refuses a component declared with other names in one statement", () => {
    const a = one(`import { Label } from "./native";

export const Badge = (): Label => new Label(),
  twice = (n: number): number => n * 2;
`);

    expect(messages(a, "LUCENT3020")).toEqual([
      "`Badge` is declared with other names in one statement: declare a component in its own `export const`",
    ]);
  });

  it("takes an overloaded component's implementation, not its signatures", () => {
    const a = one(`import { Label } from "./native";

export function Badge(props: { n: number }): Label;
export function Badge(props: { n: number }): Label {
  return new Label();
}
`);

    expect(a.components.map((c) => c.export)).toEqual(["Badge"]);
    expect(a.declarations.size).toBe(1);
  });

  it("refuses destructured props: setup runs once, and would keep their first values", () => {
    const a = one(`import { Label } from "./native";

export function Tap({ onTap }: { onTap: () => void }): Label {
  const label = new Label();
  label.onTap(() => onTap());
  return label;
}
`);

    expect(a.diagnostics.map((d) => d.message)).toEqual([
      "`Tap` destructures its props: setup runs once, so read `props.name` where the value is used, and a destructured prop would keep its first value",
    ]);
  });

  it("ignores other platforms' views in what a function returns", () => {
    const source = `import { Label, Widget } from "./native";

export function Title(props: { ios: boolean }) {
  return props.ios ? new Label() : new Widget();
}
`;
    const ios = one(source);
    const android = views({ "m.lucent.tsx": source }, { platform: "android" });

    expect(ios.diagnostics).toEqual([]);
    expect(ios.components[0]!.platforms.ios!.root).toEqual({ module: "native", name: "Label" });
    expect(android.components[0]!.platforms.android!.root).toEqual({
      module: "native",
      name: "Widget",
    });
  });

  it("finds components in every platform's branches on the host", () => {
    const a = views(
      {
        "m.lucent.tsx": `import { PLATFORM } from "lucent:platform";
import { Label, Widget } from "./native";

export function Title() {
  if (PLATFORM === "ios") return new Label();
  return new Widget();
}
`,
      },
      { platform: "host" },
    );

    expect(a.diagnostics).toEqual([]);
    expect(a.components.map((c) => [c.export, c.platforms])).toEqual([["Title", {}]]);
  });

  it("allows a component's type in type positions", () => {
    const a = one(`${TITLE}
export type TitleProps = Parameters<typeof Title>[0];
`);

    expect(a.diagnostics).toEqual([]);
  });
});
