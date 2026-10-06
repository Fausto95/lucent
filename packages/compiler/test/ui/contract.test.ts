import { describe, expect, it } from "vite-plus/test";
import { registrationName } from "../../src/ui/contract.ts";
import { messages, one, views } from "./fixture.ts";

const METER = `import { Label } from "./native";

export function Meter(props: { value: number }): Label {
  const label = new Label();
  label.text = String(props.value);
  return label;
}
`;

describe("component identity", () => {
  it("is package, module path and export, never the basename", () => {
    const a = views({
      "src/meter.lucent.tsx": METER.replace("./native", "../native"),
      "node_modules/@acme/gauges/package.json": JSON.stringify({
        name: "@acme/gauges",
        lucent: { sources: "src" },
      }),
      "node_modules/@acme/gauges/src/meter.lucent.tsx": METER.replace(
        "./native",
        "../../../../native",
      ),
    });

    expect(a.diagnostics).toEqual([]);
    expect(
      a.components.map((c) => [c.id, c.package, c.module, c.export, c.jsModule, c.registration]),
    ).toEqual([
      [
        "@acme/app/src/meter#Meter",
        "@acme/app",
        "src/meter",
        "Meter",
        "meter",
        "LucentMeter_65d9bbc8b45c",
      ],
      [
        "@acme/gauges/meter#Meter",
        "@acme/gauges",
        "meter",
        "Meter",
        "@acme/gauges/meter",
        "LucentMeter_c104410e10ce",
      ],
    ]);
  });

  it("gives every identity one registration name, valid in C++, Objective-C and Java", () => {
    expect(registrationName("@acme/app/src/meter#Meter")).toBe("LucentMeter_65d9bbc8b45c");
    expect(registrationName("@acme/app/src/meter#Meter")).toBe(
      registrationName("@acme/app/src/meter#Meter"),
    );
    expect(registrationName("@acme/app/x#$weird_Ω")).toMatch(/^Lucent_weird___[0-9a-f]{12}$/);
  });

  it("is the same for a platform module's implementations and its declaration", () => {
    const a = views(
      {
        "meter.lucent.tsx":
          'import type { View } from "./native";\n\nexport declare function Meter(props: { value: number }): View;\n',
        "meter.ios.lucent.tsx": METER,
      },
      { references: ["meter.lucent.tsx"] },
    );

    expect(a.diagnostics).toEqual([]);
    expect(a.components.map((c) => c.id)).toEqual(["@acme/app/meter#Meter"]);
  });

  it("names the SDK class a Lucent subclass derives from as the root", () => {
    const [c] = one(`import { Label } from "./native";

class Card extends Label {}

export function Cards(): Card {
  return new Card();
}
`).components;

    expect(c!.platforms.ios!.root).toEqual({ module: "native", name: "Label" });
  });

  it("names the platform, the root view class and the host artifacts", () => {
    const [c] = one(METER, "meter").components;

    expect(c!.platforms).toEqual({
      ios: {
        root: { module: "native", name: "Label" },
        artifact: "LucentMeter_df95023635f0ComponentView",
      },
    });
    expect(c!.source).toMatchObject({ line: 3, column: 1 });
  });
});

describe("props and events", () => {
  it("derive from the props type: values in order, callbacks as event slots", () => {
    const [c, ...rest] = one(`import { Label } from "./native";

type Range = { min: number; max: number };

type Props = {
  value: number;
  label?: string | null;
  mode: "full" | "compact";
  marks: readonly number[];
  range: Range;
  enabled: boolean;
  onChange?: (value: number, final: boolean) => void;
  onReset: () => void;
};

export function Meter(props: Props): Label {
  return new Label();
}
`).components;

    expect(rest).toEqual([]);
    expect(c!.props).toEqual([
      { name: "value", type: { k: "number" }, optional: false },
      { name: "label", type: { k: "nullable", inner: { k: "string" } }, optional: true },
      { name: "mode", type: { k: "enum", values: ["compact", "full"] }, optional: false },
      { name: "marks", type: { k: "array", element: { k: "number" } }, optional: false },
      {
        name: "range",
        type: {
          k: "object",
          fields: [
            { name: "min", type: { k: "number" }, optional: false },
            { name: "max", type: { k: "number" }, optional: false },
          ],
        },
        optional: false,
      },
      { name: "enabled", type: { k: "boolean" }, optional: false },
    ]);
    expect(c!.events).toEqual([
      {
        name: "onChange",
        slot: 0,
        optional: true,
        params: [
          { name: "value", type: { k: "number" }, optional: false },
          { name: "final", type: { k: "boolean" }, optional: false },
        ],
        delivery: "discrete",
      },
      { name: "onReset", slot: 1, optional: false, params: [], delivery: "discrete" },
    ]);
  });

  it("refuse values view props cannot carry, with the path to them", () => {
    const a = one(`import { Label, View } from "./native";

class Point {
  x = 0;
}

type Props = {
  count: bigint;
  view: View;
  at: Date;
  nested: { f: () => void };
  point: Point;
  items: Map<string, number>;
};

export function Bad(props: Props): Label {
  return new Label();
}
`);

    expect(a.components).toEqual([]);
    expect(messages(a, "LUCENT3021")).toEqual([
      "`Bad`'s prop `count` is a bigint, which view props cannot carry: pass a number or a string",
      "`Bad`'s prop `view` is a main-thread native object (View): views take plain data (numbers, strings, booleans, arrays and plain objects)",
      "`Bad`'s prop `at` is a `Date`: views take plain data (numbers, strings, booleans, arrays and plain objects)",
      "`Bad`'s prop `nested.f` is a function: only a top-level prop can be an event",
      "`Bad`'s prop `point` is a `Point` object: views take plain data (numbers, strings, booleans, arrays and plain objects)",
      "`Bad`'s prop `items` is a `Map`: views take plain data (numbers, strings, booleans, arrays and plain objects)",
    ]);
  });

  it("take undefined as a missing value, and refuse it where no value may be missing", () => {
    const a = one(`import { Label } from "./native";

type Props = {
  b: number | undefined;
  range: Readonly<{ min: number }>;
  onX: (() => void) | undefined;
  onY: (v: number | undefined) => void;
};

export function Meter(props: Props): Label {
  return new Label();
}
`);
    const [c] = a.components;

    expect(a.diagnostics).toEqual([]);
    expect(c!.props).toEqual([
      { name: "b", type: { k: "number" }, optional: true },
      {
        name: "range",
        type: { k: "object", fields: [{ name: "min", type: { k: "number" }, optional: false }] },
        optional: false,
      },
    ]);
    expect(c!.events).toEqual([
      { name: "onX", slot: 0, optional: true, params: [], delivery: "discrete" },
      {
        name: "onY",
        slot: 1,
        optional: false,
        params: [{ name: "v", type: { k: "number" }, optional: true }],
        delivery: "discrete",
      },
    ]);
  });

  it("refuse recursive types, index signatures and missing array elements", () => {
    const a = one(`import { Label } from "./native";

type Tree = { label: string; kids: Tree[] };

type Props = {
  tree: Tree;
  counts: { [name: string]: number };
  xs: (number | undefined)[];
};

export function Bad(props: Props): Label {
  return new Label();
}
`);

    expect(messages(a, "LUCENT3021")).toEqual([
      "`Bad`'s prop `tree.kids[i]` is a recursive type: views take plain data (numbers, strings, booleans, arrays and plain objects)",
      "`Bad`'s prop `counts` is an object with an index signature: views take objects with declared fields",
      "`Bad`'s prop `xs[i]` is a value that may be undefined: use null for a missing value",
    ]);
  });

  it("refuse the names React and the host keep", () => {
    const a = one(`import { Label } from "./native";

export function Bad(props: { key: string; ref: number; style: string; children: string }): Label {
  return new Label();
}
`);

    expect(messages(a, "LUCENT3021")).toEqual([
      "`Bad`'s prop `key` is a name React keeps: rename it",
      "`Bad`'s prop `ref` is a name React keeps: rename it",
      "`Bad`'s prop `style` is a name the host keeps for React Native styles: rename it",
      "`Bad`'s prop `children` is a name React keeps for its children: type it `Children` (lucent:ui) to take React children, or rename it",
    ]);
  });

  it("deliver each event discretely, unless lucent:ui marks it continuous or coalesced", () => {
    const [c] = one(`import { Label } from "./native";
import type { Coalesced, Continuous } from "./ui";

export function Slider(props: {
  onPick?: (n: number) => void;
  onDrag?: Continuous<(n: number) => void>;
  onScroll: Coalesced<(offset: number, final?: boolean) => void>;
}): Label {
  return new Label();
}
`).components;

    expect(c!.events.map((e) => [e.name, e.delivery, e.optional])).toEqual([
      ["onPick", "discrete", true],
      ["onDrag", "continuous", true],
      ["onScroll", "coalesced", false],
    ]);
    expect(c!.events[2]!.params).toEqual([
      { name: "offset", type: { k: "number" }, optional: false },
      { name: "final", type: { k: "boolean" }, optional: true },
    ]);
  });

  it("refuse an event marked both continuous and coalesced", () => {
    const a = one(`import { Label } from "./native";
import type { Coalesced, Continuous } from "./ui";

export function Bad(props: { onDrag: Coalesced<Continuous<(n: number) => void>> }): Label {
  return new Label();
}
`);

    expect(messages(a, "LUCENT3021")).toEqual([
      "`Bad`'s event `onDrag` is marked both continuous and coalesced: mark it once (a coalesced event is continuous)",
    ]);
  });

  it("refuse functions anywhere but a top-level event: JavaScript functions stay in JavaScript", () => {
    const a = one(`import { Label } from "./native";
import { expose } from "./ui";

export function Bad(props: { onAsk: (answer: (ok: boolean) => void) => void }): Label {
  expose({
    run: (done: () => void) => {},
    make: (): (() => void) => () => {},
  });
  return new Label();
}
`);

    expect(messages(a, "LUCENT3021")).toEqual([
      "`Bad`'s event `onAsk` sends `answer`, which is a function: only a top-level prop can be an event",
      "`Bad`'s command `run` takes `done`, which is a function: only a top-level prop can be an event",
      "`Bad`'s command `make` answers `result`, which is a function: only a top-level prop can be an event",
    ]);
  });

  it("refuse events that return values, are misnamed or send what cannot cross", () => {
    const a = one(`import { Label, View } from "./native";

type Props = {
  onPick: (n: number) => number;
  changed: () => void;
  onView: (v: View) => void;
};

export function Bad(props: Props): Label {
  return new Label();
}
`);

    expect(messages(a, "LUCENT3021")).toEqual([
      "`Bad`'s event `onPick` returns `number`: JavaScript handles events later, so an event returns nothing; give the view the value as a prop instead",
      "`Bad`'s prop `changed` is a function: a function prop is an event, named `on` and a capital letter (`onChanged`)",
      "`Bad`'s event `onView` sends `v`, which is a main-thread native object (View): views take plain data (numbers, strings, booleans, arrays and plain objects)",
    ]);
  });
});

describe("React children", () => {
  const CARD = `import { Label, View } from "./native";
import { type Children, slot } from "./ui";

export function Card(props: { title: string; children?: Children }): Label {
  const card = new Label();
  const content = slot<View>();

  card.text = props.title;
  content.title = props.title;
  return card;
}
`;

  it("come through a `children: Children` prop, into the slot setup makes", () => {
    const [c] = one(CARD).components;

    expect(c!.props).toEqual([{ name: "title", type: { k: "string" }, optional: false }]);
    expect(c!.events).toEqual([]);
    expect(c!.children).toEqual({ optional: true });
  });

  it("are required when the prop is", () => {
    const [c] = one(CARD.replace("children?: Children", "children: Children")).components;

    expect(c!.children).toEqual({ optional: false });
  });

  it("are none without the prop", () => {
    expect(one(METER).components[0]!.children).toBeUndefined();
  });

  it("need a slot, and a slot needs them", () => {
    const a = one(`import { Label, View } from "./native";
import { type Children, slot } from "./ui";

export function Unplaced(props: { children?: Children }): Label {
  return new Label();
}

export function Childless(props: { title: string }): Label {
  const content = slot<View>();
  return new Label();
}
`);

    expect(messages(a, "LUCENT3021")).toEqual([
      "`Unplaced` takes children, but its setup makes no slot for them: `const content = slot<UIView>()` (the platform's container), put in the view it returns",
      "`Childless` makes a slot, but its props take no children: declare `children?: Children` (lucent:ui)",
    ]);
  });

  it("go in one slot, made once at the top of setup, of the platform's container class", () => {
    const a = one(`import { Label, View } from "./native";
import { type Children, slot } from "./ui";

export function Twice(props: { children?: Children }): Label {
  const a = slot<View>();
  const b = slot<View>();
  return new Label();
}

export function Late(props: { children?: Children }): Label {
  const label = new Label();
  label.onTap(() => {
    const content = slot<View>();
  });
  return label;
}

export function Loose(props: { children?: Children }): Label {
  slot<View>();
  return new Label();
}

export function Labelled(props: { children?: Children }): Label {
  const content = slot<Label>();
  return new Label();
}

export function plain(): number {
  const content = slot<View>();
  return 1;
}
`);

    expect(messages(a, "LUCENT3021")).toEqual([
      "`Twice` calls slot more than once: a component has one slot for its children",
      "`Late` calls slot in a nested function: a component makes its slot once, while it sets up",
      "`Loose` calls slot outside a declaration: keep its view, `const content = slot<UIView>()`, at the top level of its setup, or of a PLATFORM branch",
      "`Labelled`'s slot is a `Label`: a slot is the platform's container, `slot<UIView>()`",
      "slot is for components, and `plain` is not one: a component is an exported function returning a view",
    ]);
  });
});

describe("ref commands", () => {
  it("derive from expose: void commands enqueue, others answer with a promise", () => {
    const [c] = one(`import { Label } from "./native";
import { expose } from "./ui";

export function Meter(props: { value: number }): Label {
  const label = new Label();
  expose({
    reset: () => {
      label.text = "";
    },
    measure: (scale: number): number => scale * 2,
    load: async (name: string): Promise<string> => name,
  });
  return label;
}
`).components;

    expect(c!.commands).toEqual([
      { name: "reset", params: [], result: { kind: "enqueue" } },
      {
        name: "measure",
        params: [{ name: "scale", type: { k: "number" }, optional: false }],
        result: { kind: "request", value: { k: "number" } },
      },
      {
        name: "load",
        params: [{ name: "name", type: { k: "string" }, optional: false }],
        result: { kind: "request", value: { k: "string" } },
      },
    ]);
  });

  it("refuse results that may be undefined", () => {
    const a = one(`import { Label } from "./native";
import { expose } from "./ui";

export function Meter(props: { value: number }): Label {
  expose({ get: async (): Promise<number | undefined> => undefined });
  return new Label();
}
`);

    expect(messages(a, "LUCENT3021")).toEqual([
      "`Meter`'s command `get` answers `result`, which is a value that may be undefined: use null for a missing value",
    ]);
  });

  it("are none without expose", () => {
    expect(one(METER).components[0]!.commands).toEqual([]);
  });

  it("refuse expose inside a statement, outside components, or given a variable", () => {
    const a = one(`import { Label } from "./native";
import { expose } from "./ui";

export function Maybe(props: { on: boolean }): Label {
  if (props.on) expose({ a: () => {} });
  return new Label();
}

export function Named(props: { on: boolean }): Label {
  const commands = { a: () => {} };
  expose(commands);
  return new Label();
}

export function plain(): number {
  expose({ a: () => {} });
  return 1;
}
`);

    expect(messages(a, "LUCENT3021")).toEqual([
      "`Maybe` calls expose inside a statement: call it once, at the top level of its setup",
      "`Named` gives expose `commands`: give it an object literal, so its commands are known",
      "expose is for components, and `plain` is not one: a component is an exported function returning a view",
    ]);
  });

  it("refuse expose outside setup, twice, or with commands that are not plain functions", () => {
    const a = one(`import { Label, View } from "./native";
import { expose } from "./ui";

export function Late(props: { value: number }): Label {
  const label = new Label();
  label.onTap(() => expose({ reset: () => {} }));
  return label;
}

export function Twice(props: { value: number }): Label {
  expose({ a: () => {} });
  expose({ b: () => {} });
  return new Label();
}

export function Bad(props: { value: number }): Label {
  expose({ version: 1, attach: (v: View) => {} });
  return new Label();
}
`);

    expect(messages(a, "LUCENT3021")).toEqual([
      "`Late` calls expose in a nested function: a component exposes its commands once, while it sets up",
      "`Twice` calls expose more than once: expose every command in one object",
      "`Bad`'s command `version` is not a function: every exposed member is a command",
      "`Bad`'s command `attach` takes `v`, which is a main-thread native object (View): views take plain data (numbers, strings, booleans, arrays and plain objects)",
    ]);
  });
});
