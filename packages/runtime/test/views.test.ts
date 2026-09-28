import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import type { ComponentConfig } from "../js/views.d.ts";

const viewsFile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../js/views.js");

type Props = Record<string, unknown>;
type Element = { type: unknown; props: Props; children: unknown[] };
type Ref<T> = { current: T };

interface Views {
  lucentComponent(
    config: ComponentConfig,
    react: object,
    reactNative: object,
  ): (p: Props) => Element;
  settleRequest(id: number, error: string | null | undefined, value?: unknown): void;
}

/** A gauge: every kind of prop, two events, a command and two requests. */
const GAUGE: ComponentConfig = {
  name: "LucentGauge_0",
  displayName: "Gauge",
  props: [
    { name: "value", key: "p0", shape: 0 },
    { name: "detail", key: "p1", shape: { n: 0 } },
    { name: "points", key: "p2", shape: { a: { o: [{ name: "y", shape: { n: 0 } }] } } },
    { name: "tags", key: "p3", shape: { a: { n: 0 } } },
  ],
  events: [
    { name: "onChange", key: "e0", event: "topLucent0" },
    { name: "onReset", key: "e1", event: "topLucent1" },
  ],
  commands: [
    { name: "reset", request: false, params: [] },
    { name: "measure", request: true, params: [{ n: 0 }] },
    { name: "flush", request: true, params: [] },
  ],
};

/**
 * The views runtime in a fresh JavaScript runtime, with just enough React
 * to render one component instance at a time (hooks keep their state per
 * instance) and a React Native recording what reaches the native side.
 */
function setup(native: object | null = {}, config: ComponentConfig = GAUGE) {
  const module = { exports: {} as Views };
  new Function("module", "exports", fs.readFileSync(viewsFile, "utf8"))(module, module.exports);

  let hooks: { state: unknown[]; index: number; effects: (() => unknown)[] } | undefined;
  const hook = <T>(init: () => T): T => {
    const h = hooks!;
    if (h.index === h.state.length) h.state.push(init());
    return h.state[h.index++] as T;
  };

  const React = {
    createElement: (type: unknown, props: Props, ...children: unknown[]): Element => ({
      type,
      props,
      children,
    }),
    useRef: <T>(init: T) => hook(() => ({ current: init })),
    useState: <T>(init: () => T) => [hook(init), () => {}],
    useImperativeHandle: (ref: Ref<unknown> | undefined, make: () => unknown) => {
      hook(() => {
        hooks!.effects.push(() => ref && (ref.current = make()));
      });
    },
    useEffect: (effect: () => (() => void) | void) => {
      hook(() => {
        hooks!.effects.push(effect);
      });
    },
  };

  const registered: { name: string; config: unknown }[] = [];
  const dispatched: { instance: unknown; command: string; args: unknown[] }[] = [];
  const connections: ((id: number, error: string | null, value?: unknown) => void)[] = [];
  const nativeHost =
    native &&
    Object.assign(native, {
      __lucentViewRequests: (settle: (typeof connections)[number]) => connections.push(settle),
    });

  const ReactNative = {
    NativeComponentRegistry: {
      get: (name: string, provider: () => unknown) => {
        registered.push({ name, config: provider() });
        return `native:${name}`;
      },
    },
    codegenNativeCommands: ({ supportedCommands }: { supportedCommands: string[] }) =>
      Object.fromEntries(
        supportedCommands.map((command) => [
          command,
          (instance: unknown, ...args: unknown[]) => dispatched.push({ instance, command, args }),
        ]),
      ),
    TurboModuleRegistry: { get: (name: string) => (name === "Lucent" ? nativeHost : null) },
  };

  const Gauge = module.exports.lucentComponent(config, React, ReactNative);

  let tags = 0;

  /** Mounts an instance: renders it, attaches its native view (a new tag), runs its effects. */
  const mount = (props: Props) => {
    const instance = { state: [] as unknown[], index: 0, effects: [] as (() => unknown)[] };
    const view = { tag: ++tags };
    const cleanups: unknown[] = [];

    const render = (next: Props) => {
      hooks = instance;
      instance.index = 0;
      const element = Gauge(next);
      hooks = undefined;
      return element;
    };

    const element = render(props);
    (element.props.ref as Ref<unknown>).current = view;
    for (const effect of instance.effects.splice(0)) cleanups.push(effect());

    return {
      element,
      view,
      render,
      unmount: () => {
        for (const cleanup of cleanups) if (typeof cleanup === "function") cleanup();
        (element.props.ref as Ref<unknown>).current = null;
      },
    };
  };

  return { views: module.exports, Gauge, mount, registered, dispatched, connections };
}

const required = { value: 1, points: [], onReset: () => {} };

describe("a component's view configuration", () => {
  it("names the native view and maps each event's slot to its handler's key", () => {
    const { registered } = setup();

    expect(registered).toEqual([
      {
        name: "LucentGauge_0",
        config: {
          uiViewClassName: "LucentGauge_0",
          validAttributes: { p0: true, p1: true, p2: true, p3: true, e0: true, e1: true },
          directEventTypes: {
            topLucent0: { registrationName: "e0" },
            topLucent1: { registrationName: "e1" },
          },
        },
      },
    ]);
  });
});

describe("a component's props", () => {
  it("go to the native view under their keys, with the host's style", () => {
    const { mount } = setup();
    const style = { height: 80 };
    const { element } = mount({ ...required, style });

    expect(element.type).toBe("native:LucentGauge_0");
    expect(element.props).toMatchObject({ p0: 1, p2: [], style });
  });

  it("leave a missing prop out, and box a nullable one: null and a value stay apart", () => {
    const { mount } = setup();

    expect(mount(required).element.props).not.toHaveProperty("p1");
    expect(mount({ ...required, detail: undefined }).element.props).not.toHaveProperty("p1");
    expect(mount({ ...required, detail: null }).element.props.p1).toEqual([null]);
    expect(mount({ ...required, detail: "hi" }).element.props.p1).toEqual(["hi"]);
  });

  it("box the nullable values arrays and objects hold, leaving missing fields out", () => {
    const { mount } = setup();
    const { element } = mount({
      ...required,
      points: [{ x: 1, y: null }, { x: 2, y: 3 }, { x: 4 }],
      tags: ["a", null],
    });

    expect(element.props.p2).toEqual([{ x: 1, y: [null] }, { x: 2, y: [3] }, { x: 4 }]);
    expect(element.props.p2).not.toHaveProperty([2, "y"]);
    expect(element.props.p3).toEqual([["a"], [null]]);
  });
});

describe("a component's events", () => {
  it("have a handler only while their callback is a function", () => {
    const { mount } = setup();

    expect(mount({ ...required, onChange: () => {} }).element.props.e0).toBeTypeOf("function");
    expect(mount(required).element.props).not.toHaveProperty("e0");
  });

  it("call the callback with the payload's arguments, as many as the native call passed", () => {
    const { mount } = setup();
    const calls: unknown[][] = [];
    const { element } = mount({ ...required, onChange: (...args: unknown[]) => calls.push(args) });
    const handler = element.props.e0 as (e: { nativeEvent: object }) => void;

    // React Native adds the view's tag to every payload as `target`.
    handler({ nativeEvent: { args: [1], target: 3 } });
    handler({ nativeEvent: { args: [2, "drag"], target: 3 } });
    handler({ nativeEvent: { args: [undefined, "drag"], target: 3 } });

    expect(calls).toEqual([[1], [2, "drag"], [undefined, "drag"]]);
  });
});

describe("a component's replaced callbacks", () => {
  it("send an event to the latest commit's callback, and none once it is removed", () => {
    const { mount } = setup();
    const heard: string[] = [];
    const first = (v: unknown) => heard.push(`first ${String(v)}`);
    const second = (v: unknown) => heard.push(`second ${String(v)}`);
    const { render } = mount({ ...required, onChange: first });
    const event = { nativeEvent: { args: [1], target: 3 } };

    const replaced = render({ ...required, onChange: second });
    (replaced.props.e0 as (e: object) => void)(event);

    // Removed: the view hears JavaScript no longer listens (its handler goes), and sends nothing.
    expect(render({ ...required }).props).not.toHaveProperty("e0");
    expect(heard).toEqual(["second 1"]);
  });
});

describe("a component whose prop names objects inherit", () => {
  it("sends only the props React was given", () => {
    const { mount } = setup(
      {},
      {
        name: "LucentOdd_0",
        displayName: "Odd",
        props: [
          { name: "toString", key: "p0", shape: 0 },
          { name: "constructor", key: "p1", shape: 0 },
        ],
        events: [],
        commands: [],
      },
    );

    expect(mount({}).element.props).not.toHaveProperty("p0");
    expect(mount({}).element.props).not.toHaveProperty("p1");
    expect(mount({ constructor: "c" }).element.props.p1).toBe("c");
  });
});

describe("a component's commands", () => {
  const refOf = (props: Props) => {
    const ref = { current: null as Record<string, (...args: unknown[]) => unknown> | null };
    return { ref, props: { ...required, ...props, ref } };
  };

  it("send a void command to the mounted view, arguments encoded and extra ones dropped", () => {
    const { mount, dispatched } = setup();
    const { ref, props } = refOf({});
    const { view } = mount(props);

    ref.current!.reset!("extra");

    expect(dispatched).toEqual([{ instance: view, command: "reset", args: [] }]);
  });

  it("answer a request through the host's channel, by id", async () => {
    const { mount, dispatched, connections } = setup();
    const { ref, props } = refOf({});
    const { view } = mount(props);

    const measured = ref.current!.measure!(null);
    const flushed = ref.current!.flush!();

    expect(dispatched).toEqual([
      { instance: view, command: "measure", args: [1, [null]] },
      { instance: view, command: "flush", args: [2] },
    ]);
    expect(connections).toHaveLength(1);

    connections[0]!(1, null, 42);
    connections[0]!(2, "the view went away");

    await expect(measured).resolves.toBe(42);
    await expect(flushed).rejects.toThrow("Lucent: the view went away");
  });

  it("reject a request when its view unmounts (an AbortError), and ignore its late answer", async () => {
    const { mount, views } = setup();
    const { ref, props } = refOf({});
    const { unmount } = mount(props);
    const handle = ref.current!;

    const measured = handle.measure!("pt");
    unmount();
    views.settleRequest(1, null, 42);

    await expect(measured).rejects.toThrow("Gauge unmounted before answering");
    await expect(measured).rejects.toMatchObject({ name: "AbortError" });
  });

  it("refuse commands while the view is not mounted (an InvalidStateError), before and after", async () => {
    const { mount, dispatched } = setup();
    const { ref, props } = refOf({});
    const { element, unmount } = mount(props);
    const handle = ref.current!;
    const host = element.props.ref as Ref<unknown>;

    // Before the native view is attached (or once React let go of it).
    const view = host.current;
    host.current = null;
    expect(() => handle.reset!()).toThrow("Gauge.reset(): the view is not mounted");
    host.current = view;

    unmount();

    const error = (() => {
      try {
        handle.reset!();
      } catch (e) {
        return e;
      }
    })();

    expect(error).toMatchObject({
      name: "InvalidStateError",
      message: "Lucent: Gauge.reset(): the view is not mounted.",
    });
    await expect(handle.flush!()).rejects.toMatchObject({ name: "InvalidStateError" });
    expect(dispatched).toEqual([]);
  });

  it("reject with the native side's message a request the view could not answer", async () => {
    const { mount, connections } = setup();
    const { ref, props } = refOf({});
    mount(props);

    const measured = ref.current!.measure!("pt");
    connections[0]!(1, 'measure: unit: "cm" is none of the declared strings');

    await expect(measured).rejects.toMatchObject({
      name: "Error",
      message: 'Lucent: measure: unit: "cm" is none of the declared strings',
    });
  });

  it("keep two instances' views and requests apart", async () => {
    const { mount, dispatched, views } = setup();
    const first = refOf({});
    const second = refOf({});
    const a = mount(first.props);
    const b = mount(second.props);

    const fromA = first.ref.current!.flush!();
    const fromB = second.ref.current!.flush!();
    second.ref.current!.reset!();

    expect(dispatched.map((d) => [d.instance, d.command, d.args])).toEqual([
      [a.view, "flush", [1]],
      [b.view, "flush", [2]],
      [b.view, "reset", []],
    ]);

    a.unmount();
    views.settleRequest(2, null, "b");

    await expect(fromA).rejects.toThrow("unmounted before answering");
    await expect(fromB).resolves.toBe("b");
  });

  it("reject a request when the app's native code has no channel for it", async () => {
    const { mount } = setup(null);
    const { ref, props } = refOf({});
    mount(props);

    await expect(ref.current!.flush!()).rejects.toMatchObject({
      code: "LUCENT_NATIVE_MISMATCH",
      action: "compile-native",
    });
  });
});

describe("React children", () => {
  const CARD: ComponentConfig = {
    name: "LucentCard_0",
    displayName: "Card",
    children: true,
    props: [{ name: "title", key: "p0", shape: 0 }],
    events: [],
    commands: [],
  };

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("go to the native view of a component taking them, as React's children", () => {
    const { mount } = setup({}, CARD);
    const children = ["text", { type: "Text", props: {} }];
    const { element } = mount({ title: "Trip", children });

    expect(element.children).toEqual([children]);
    expect(element.props).toEqual({ style: undefined, p0: "Trip", ref: expect.anything() });
  });

  it("are left out of a component taking none, which says so once", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { mount } = setup();
    const { element } = mount({ ...required, children: "one" });

    mount({ ...required, children: "two" });

    expect(element.children).toEqual([]);
    expect(element.props).not.toHaveProperty("children");
    expect(errors.mock.calls).toEqual([
      [
        "Lucent: Gauge takes no children (its props declare no `children: Children`): they are not rendered.",
      ],
    ]);
  });

  it("are no concern of a component given none", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const { mount } = setup();

    expect(mount(required).element.children).toEqual([]);
    expect(errors).not.toHaveBeenCalled();
  });
});
