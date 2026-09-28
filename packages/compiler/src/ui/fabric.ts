/**
 * The Fabric side of each component, generated from its description: the
 * props React commits (each prop missing, null or its value), the events
 * its view sends, the commands its ref sends, and the shadow node and
 * descriptor React Native's renderer registers under the component's
 * registration name.
 *
 * One header and one source per component, in namespace
 * `lucent::views::<registration>`, and a registry adding every
 * component's descriptor. Values have plain C++ types (double, bool,
 * std::string, std::vector, std::optional for null, a struct per object
 * and per enum), which the renderer may build on any thread;
 * runtime/cpp/rn/LucentViews.h holds what the components share.
 */
import { cpp } from "@lucent-lang/codegen";
import { cppIdent } from "../types.ts";
import type {
  CommandDescription,
  ComponentDescription,
  EventDelivery,
  EventDescription,
  ViewField,
  ViewType,
} from "./contract.ts";
import { eventName, handlerKey, propKey } from "./transport.ts";

export { fabricViews } from "./switch.ts";

/** The directory of the view sources, under the native package's generated C++. */
export const VIEWS_DIR = "views";

/** The registry's header, which the platform hosts include. */
export const REGISTRY_HEADER = `${VIEWS_DIR}/lucent_views.h`;

const react = (name: string) => cpp.type(`facebook::react::${name}`);
const jsi = (name: string) => cpp.type(`facebook::jsi::${name}`);
const helper = (name: string) => cpp.id(`lucent::views::${name}`);
const constRef = (t: cpp.Type) => cpp.reference(cpp.constType(t));
const optional = (t: cpp.Type) => cpp.type("std::optional", t);
const stdArray = (items: string[]) =>
  cpp.construct(
    cpp.type("std::array", cpp.type("const char*"), cpp.num(items.length)),
    items.map(cpp.str),
    true,
  );

const RAW_VALUE = react("RawValue");
const RUNTIME = cpp.reference(jsi("Runtime"));
const JS_VALUE = jsi("Value");

/** The parameters and locals of the generated functions. */
const LOCALS = [
  "a",
  "b",
  "from",
  "object",
  "out",
  "previous",
  "raw",
  "runtime",
  "source",
  "value",
] as const;
const v = Object.fromEntries(LOCALS.map((n) => [n, cpp.id(n)])) as Record<
  (typeof LOCALS)[number],
  cpp.Expr
>;

/** The generated view sources, by path under the generated C++: deterministic for any order of `components`. */
export function fabricSources(components: readonly ComponentDescription[]): Map<string, string> {
  const sorted = components.toSorted((a, b) => compare(a.registration, b.registration));
  const files = new Map<string, string>();

  for (const c of sorted) {
    const view = componentSources(c);

    files.set(`${VIEWS_DIR}/${c.registration}.h`, view.header);
    files.set(`${VIEWS_DIR}/${c.registration}.cpp`, view.source);
  }

  const registry = registrySources(sorted);

  files.set(REGISTRY_HEADER, registry.header);
  files.set(`${VIEWS_DIR}/lucent_views.cpp`, registry.source);

  return files;
}

const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

// --- names ----------------------------------------------------------------------------

/**
 * C++ names for the fields of one struct: each as cppIdent spells it,
 * numbered (`_2`, `_3`…) when another field or the struct itself (`taken`)
 * has that name already.
 */
function structFieldNames(
  fields: readonly { name: string }[],
  taken: readonly string[] = [],
): string[] {
  const used = new Set(taken);

  return fields.map((f) => {
    const base = cppIdent(f.name);
    // cppIdent never gives `__`, which C++ reserves.
    const join = base.endsWith("_") ? "" : "_";
    let name = base;

    for (let n = 2; used.has(name); n++) name = `${base}${join}${n}`;

    used.add(name);

    return name;
  });
}

const eventStruct = (slot: number) => `Event${slot}`;
const commandStruct = (index: number) => `Command${index}`;

/**
 * The C++ names of a component's generated types and fields, which code
 * using them (the platform hosts' glue) follows.
 */
export const fabricNames = {
  values: (c: ComponentDescription) => structFieldNames(c.props, ["Values"]),
  event: (e: EventDescription) => structFieldNames(e.params, [eventStruct(e.slot)]),
  command: (command: CommandDescription, index: number) =>
    structFieldNames(command.params, [commandStruct(index), "request_"]),
  object: (fields: readonly ViewField[]) => structFieldNames(fields),
  eventStruct,
  commandStruct,
  /** The type of a request's answer, when it has one. */
  result: (index: number) => `Result${index}`,
};

// --- value types ----------------------------------------------------------------------

/**
 * The C++ types of one component's values. Each object and each enum gets a
 * struct, with the `read`, `same` and `toJs` the shared templates find for
 * it; a struct comes after the ones it holds. Generated names end in `_`,
 * which cppIdent never gives a program's name, so no field hides them.
 */
class ValueTypes {
  readonly decls: cpp.Decl[] = [];
  readonly defs: cpp.Decl[] = [];
  /** The C++ names of the program's fields, props and parameters. */
  readonly names = new Set<string>();
  private count = { Object: 0, Enum: 0 };

  /** The C++ type of a value of type `t`; `path` names it in comments. */
  of(t: ViewType, path: string): cpp.Type {
    switch (t.k) {
      case "number":
        return cpp.type("double");
      case "boolean":
        return cpp.type("bool");
      case "string":
        return cpp.type("std::string");
      case "array":
        return cpp.type("std::vector", this.of(t.element, `${path}[]`));
      case "nullable":
        return optional(this.of(t.inner, path));
      case "enum":
        return this.enumType(t.values, path);
      case "object":
        return this.objectType(t.fields, path);
    }
  }

  /** A field's C++ type: optional when it may be missing. */
  field(f: ViewField, path: string): cpp.Type {
    const t = this.of(f.type, `${path}.${f.name}`);

    return f.optional ? optional(t) : t;
  }

  /** structFieldNames, shielded from macros with the others. */
  fieldNames(fields: readonly { name: string }[], taken: readonly string[] = []): string[] {
    const names = structFieldNames(fields, taken);

    for (const name of names) this.names.add(name);

    return names;
  }

  private next(kind: "Object" | "Enum"): string {
    return `${kind}${this.count[kind]++}_`;
  }

  private enumType(values: readonly string[], path: string): cpp.Type {
    const name = this.next("Enum");
    const self = cpp.type(name);
    const { raw, out, a, b, runtime, value } = v;

    this.addStruct(name, path, [cpp.field(cpp.type("std::string"), "value")], {
      read: [
        cpp.exprStmt(
          cpp.call(helper("readEnum"), [raw, cpp.dot(out, "value"), stdArray([...values])]),
        ),
      ],
      same: [cpp.ret(cpp.binary(cpp.dot(a, "value"), "==", cpp.dot(b, "value")))],
      toJs: [cpp.ret(cpp.call(helper("toJs"), [runtime, cpp.dot(value, "value")]))],
    });

    return self;
  }

  private objectType(fields: readonly ViewField[], path: string): cpp.Type {
    const names = this.fieldNames(fields);
    const members = fields.map((f, i) => ({ f, name: names[i]!, type: this.field(f, path) }));
    const name = this.next("Object");
    const { raw, out, a, b, runtime, value, object, from } = v;

    const read: cpp.Stmt[] = [
      cpp.varDecl(cpp.auto, "from", cpp.call(helper("fields"), [raw])),
      ...members.map((m) =>
        cpp.exprStmt(
          cpp.call(helper(m.f.optional ? "optionalField" : "field"), [
            from,
            cpp.str(m.f.name),
            cpp.dot(out, m.name),
          ]),
        ),
      ),
    ];
    const same: cpp.Stmt[] = [
      cpp.ret(
        members.length
          ? cpp.and(
              ...members.map((m) =>
                cpp.call(helper("sameValue"), [cpp.dot(a, m.name), cpp.dot(b, m.name)]),
              ),
            )
          : cpp.bool(true),
      ),
    ];
    const toJs: cpp.Stmt[] = [
      cpp.varDecl(jsi("Object"), "object", runtime, { style: "construct" }),
      ...members.map((m) =>
        cpp.exprStmt(
          cpp.call(helper(m.f.optional ? "setOptional" : "set"), [
            runtime,
            object,
            cpp.str(m.f.name),
            cpp.dot(value, m.name),
          ]),
        ),
      ),
      cpp.ret(object),
    ];

    this.addStruct(
      name,
      path,
      members.map((m) => cpp.field(m.type, m.name)),
      { read, same, toJs },
    );

    return cpp.type(name);
  }

  /** A struct, with its `read`, `same` and `toJs` declared here and defined in the source. */
  private addStruct(
    name: string,
    path: string,
    members: cpp.Member[],
    bodies: { read: cpp.Stmt[]; same: cpp.Stmt[]; toJs: cpp.Stmt[] },
  ): void {
    const self = cpp.type(name);
    const functions = [
      {
        name: "read",
        ret: cpp.voidType,
        params: [cpp.param(constRef(RAW_VALUE), "raw"), cpp.param(cpp.reference(self), "out")],
        body: bodies.read,
      },
      {
        name: "same",
        ret: cpp.type("bool"),
        params: [cpp.param(constRef(self), "a"), cpp.param(constRef(self), "b")],
        body: bodies.same,
      },
      {
        name: "toJs",
        ret: JS_VALUE,
        params: [cpp.param(RUNTIME, "runtime"), cpp.param(constRef(self), "value")],
        body: bodies.toJs,
      },
    ];

    this.decls.push(
      { k: "comment", text: path },
      cpp.struct(name, members),
      ...functions.map((f) => cpp.fn(f.name, f.ret, f.params)),
    );
    this.defs.push(...functions.map((f) => cpp.fn(f.name, f.ret, f.params, f.body)));
  }
}

// --- components -----------------------------------------------------------------------

function componentSources(c: ComponentDescription): { header: string; source: string } {
  const layout = layoutOf(c);
  const types = new ValueTypes();
  const names = types.names;
  const propNames = types.fieldNames(c.props, ["Values"]);
  const props = c.props.map((p, i) => ({
    p,
    name: propNames[i]!,
    type: types.of(p.type, p.name),
  }));
  const params = (list: readonly ViewField[], taken: string[], of: string): Param[] => {
    const names = types.fieldNames(list, taken);

    return list.map((p, i) => ({ p, name: names[i]!, type: types.field(p, `${of}(${p.name})`) }));
  };
  const events = c.events.map((e) => ({
    e,
    params: params(e.params, [eventStruct(e.slot)], e.name),
  }));
  const commands = c.commands.map((command, index) => ({
    command,
    params: params(command.params, [commandStruct(index), "request_"], command.name),
    result:
      command.result.kind === "request" && command.result.value
        ? types.of(command.result.value, `${command.name}()`)
        : undefined,
  }));

  const PROPS = cpp.type("Props");
  const VALUES = cpp.type("Values");
  const EMITTER = cpp.type("EventEmitter");
  const handlersType = cpp.type("std::bitset", cpp.num(c.events.length));
  const changedType = cpp.type("std::bitset", cpp.num(c.props.length));
  const { raw, source, previous, out } = v;

  const propsCtorParams = [
    cpp.param(constRef(react("PropsParserContext")), "context"),
    cpp.param(constRef(PROPS), "source"),
    cpp.param(constRef(react("RawProps")), "raw"),
  ];

  const headerDecls: cpp.Decl[] = [
    ...types.decls,
    {
      k: "comment",
      text: "The component's own props: each missing (never set, or removed) or its value.",
    },
    cpp.struct(
      "Values",
      props.map((x) => cpp.field(optional(x.type), x.name)),
    ),
    { k: "comment", text: "The props of one commit." },
    cpp.struct(
      "Props",
      [
        cpp.method("Props", undefined, [], undefined, { default: true }),
        cpp.method("Props", undefined, propsCtorParams),
        cpp.field(VALUES, "values"),
        { k: "comment", text: "Whether JavaScript listens to each event, by slot." },
        cpp.field(handlersType, "handlers"),
        { k: "comment", text: "Which of `values` differ from `previous`'s, by prop." },
        cpp.method("changed", changedType, [cpp.param(constRef(PROPS), "previous")], undefined, {
          const: true,
        }),
      ],
      { bases: [{ type: react("ViewProps"), public: true }], final: true },
    ),
    ...events.flatMap((x) => [
      {
        k: "comment",
        text: `${x.e.name}(${x.e.params.map((p) => p.name).join(", ")})`,
      } as cpp.Decl,
      cpp.struct(
        eventStruct(x.e.slot),
        x.params.map((p) => cpp.field(p.type, p.name)),
      ),
    ]),
    { k: "comment", text: "Sends the component's events to the JavaScript listening to them." },
    cpp.struct(
      "EventEmitter",
      [
        { k: "using", name: "facebook::react::ViewEventEmitter::ViewEventEmitter" },
        ...events.flatMap((x): cpp.Member[] => [
          { k: "comment", text: x.e.name },
          cpp.method(
            "emit",
            cpp.voidType,
            [cpp.param(cpp.type(eventStruct(x.e.slot)), "event")],
            undefined,
            { const: true },
          ),
        ]),
      ],
      { bases: [{ type: react("ViewEventEmitter"), public: true }], final: true },
    ),
    { k: "comment", text: "The registration name, as the renderer names the component." },
    {
      k: "var",
      extern: true,
      stmt: { ...cpp.varDecl(cpp.constType(cpp.type("char")), "ComponentName"), array: true },
    },
    { k: "comment", text: layout.comment },
    {
      k: "using",
      name: "ShadowNode",
      type: cpp.type(layout.node, cpp.id("ComponentName"), PROPS, EMITTER),
    },
    {
      k: "using",
      name: "ComponentDescriptor",
      type: cpp.type("facebook::react::ConcreteComponentDescriptor", cpp.type("ShadowNode")),
    },
    ...commandDecls(commands),
    ...mountDecls(c),
  ];

  const sourceDecls: cpp.Decl[] = [
    {
      k: "var",
      extern: true,
      stmt: {
        ...cpp.varDecl(cpp.constType(cpp.type("char")), "ComponentName", cpp.str(c.registration)),
        array: true,
      },
    },
    ...types.defs,
    {
      k: "function",
      name: "readValues",
      static: true,
      ret: VALUES,
      params: [
        cpp.param(constRef(react("RawProps")), "raw"),
        cpp.param(constRef(VALUES), "source"),
      ],
      body: [
        cpp.varDecl(VALUES, "out"),
        ...props.map((x, index) =>
          cpp.exprStmt(
            cpp.assign(
              cpp.dot(out, x.name),
              cpp.call(helper("prop"), [
                raw,
                cpp.id("ComponentName"),
                cpp.str(x.p.name),
                cpp.str(propKey(index)),
                cpp.dot(source, x.name),
              ]),
            ),
          ),
        ),
        cpp.ret(out),
      ],
    },
    {
      k: "function",
      name: "Props",
      scope: PROPS,
      ret: cpp.voidType,
      ctor: true,
      params: propsCtorParams,
      initializers: [
        {
          name: "facebook::react::ViewProps",
          args: [cpp.id("context"), source, raw],
        },
        { name: "values", args: [cpp.call("readValues", [raw, cpp.dot(source, "values")])] },
        {
          name: "handlers",
          args: [
            cpp.call(helper("handlers"), [
              raw,
              stdArray(c.events.map((e) => handlerKey(e.slot))),
              cpp.dot(source, "handlers"),
            ]),
          ],
        },
      ],
      body: [],
    },
    {
      k: "function",
      name: "changed",
      scope: PROPS,
      ret: changedType,
      const: true,
      params: [cpp.param(constRef(PROPS), "previous")],
      body: [
        cpp.varDecl(changedType, "out"),
        ...props.map((x, index) =>
          cpp.exprStmt(
            cpp.call(cpp.dot(out, "set"), [
              cpp.num(index),
              cpp.not(
                cpp.call(helper("sameValue"), [
                  cpp.dot(cpp.id("values"), x.name),
                  cpp.dot(cpp.dot(previous, "values"), x.name),
                ]),
              ),
            ]),
          ),
        ),
        cpp.ret(out),
      ],
    },
    ...events.map((x): cpp.Decl => emitDefinition(x.e, x.params)),
    ...commandDefs(c, commands),
  ];

  const header = cpp.printUnit({
    banner: `Generated by Lucent from ${c.id}. Do not edit.`,
    decls: [
      { k: "pragmaOnce" },
      cpp.include(layout.header),
      cpp.include("LucentViews.h"),
      cpp.include("react/renderer/components/view/ViewEventEmitter.h", true),
      cpp.include("react/renderer/components/view/ViewProps.h", true),
      cpp.include("react/renderer/core/ConcreteComponentDescriptor.h", true),
      cpp.include("lucent/native.h", true),
      cpp.include("bitset", true),
      cpp.include("functional", true),
      cpp.include("memory", true),
      cpp.include("optional", true),
      cpp.include("string", true),
      cpp.include("variant", true),
      cpp.include("vector", true),
      ...shielded(names, [cpp.namespace(`lucent::views::${c.registration}`, headerDecls)]),
    ],
  });

  const sourceUnit = cpp.printUnit({
    banner: `Generated by Lucent from ${c.id}. Do not edit.`,
    decls: [
      cpp.include(`${c.registration}.h`),
      ...shielded(names, [cpp.namespace(`lucent::views::${c.registration}`, sourceDecls)]),
    ],
  });

  return { header, source: sourceUnit };
}

// --- layout --------------------------------------------------------------------------

/**
 * How Yoga lays a component out: as a leaf sized by its content, or as the
 * container of the React children it takes (its slot's).
 */
const LAYOUTS = {
  leaf: {
    header: "LucentViewSizing.h",
    node: "lucent::views::HostShadowNode",
    comment:
      "Fills the size its style and flex give it, else sized by its content (LucentViewSizing.h).",
  },
  container: {
    header: "LucentViewSlots.h",
    node: "lucent::views::SlotShadowNode",
    comment: "Lays out its React children, which its host mounts in its slot (LucentViewSlots.h).",
  },
} as const;

const layoutOf = (c: ComponentDescription) => LAYOUTS[c.children ? "container" : "leaf"];

// --- the mount -------------------------------------------------------------------------

/**
 * What a platform host calls to mount the component: the setup compiled
 * from its Lucent code (emit/views.ts defines these in
 * views/<registration>_mount.cpp). Everything but `update` runs on the main
 * thread.
 */
function mountDecls(c: ComponentDescription): cpp.Decl[] {
  const EVENT = cpp.type("Event");
  const EMIT = cpp.type("Emit");
  const MOUNT = cpp.type("Mount");
  const PROPS = cpp.type("Props");
  const events = c.events.map((e) => cpp.type(eventStruct(e.slot)));

  return [
    { k: "comment", text: "An event the mount sends: the host hands it to its EventEmitter." },
    {
      k: "using",
      name: "Event",
      type: cpp.type("std::variant", ...(events.length ? events : [cpp.type("std::monostate")])),
    },
    {
      k: "using",
      name: "Emit",
      type: cpp.type("std::function", cpp.fnType(cpp.voidType, [constRef(EVENT)])),
    },
    { k: "comment", text: "What a mount holds (its scope, props, commands and view)." },
    cpp.struct("MountState", [], { forward: true }),
    {
      k: "comment",
      text: "One mounted instance, set up once by the component's Lucent code.",
    },
    cpp.struct("Mount", [
      {
        k: "comment",
        text: c.children
          ? "Main thread, at committed mount: runs setup with the first props and the host's slot for the children; events go to `emit`."
          : "Main thread, at committed mount: runs setup with the first props; events go to `emit`.",
      },
      cpp.method(
        "create",
        cpp.type("std::shared_ptr", MOUNT),
        [
          cpp.param(constRef(PROPS), "props"),
          cpp.param(EMIT, "emit"),
          ...(c.children ? [cpp.param(cpp.type("lucent::NativeRef"), "slot")] : []),
        ],
        undefined,
        { static: true },
      ),
      { k: "comment", text: "The platform view setup returned; empty if setup failed." },
      cpp.method("view", cpp.type("lucent::NativeRef"), [], undefined, { const: true }),
      {
        k: "comment",
        text: "A later commit, from any thread: what changed, applied in one transaction on the main thread (at once when called there).",
      },
      cpp.method("update", cpp.voidType, [
        cpp.param(constRef(PROPS), "props"),
        cpp.param(constRef(PROPS), "previous"),
      ]),
      {
        k: "comment",
        text: "Main thread: where events go from now on; the native subscriptions setup made stay.",
      },
      cpp.method("setEmit", cpp.voidType, [cpp.param(EMIT, "emit")]),
      ...(c.commands.length
        ? [
            {
              k: "comment",
              text: "Main thread: a command, after the pending props; a request's answer goes to `respond`.",
            } as cpp.Member,
            cpp.method("command", cpp.voidType, [
              cpp.param(constRef(cpp.type("Command")), "command"),
              cpp.param(cpp.type("lucent::views::Respond"), "respond"),
            ]),
          ]
        : []),
      {
        k: "comment",
        text: "Main thread, at unmount or recycle: the mount's scope ends (effects, cleanups, subscriptions); later calls do nothing.",
      },
      cpp.method("dispose", cpp.voidType, []),
      { k: "access", level: "private" },
      cpp.field(cpp.type("std::shared_ptr", cpp.type("MountState")), "state_"),
    ]),
  ];
}

/** `decls` with the program's names undefined as macros around them. */
function shielded(names: Set<string>, decls: cpp.Decl[]): cpp.Decl[] {
  return names.size ? [cpp.withoutMacros([...names].sort(compare), decls)] : decls;
}

type Param = { p: ViewField; name: string; type: cpp.Type };

/**
 * How an event of each delivery is dispatched: in React Native's category
 * for it, or as a unique event, which replaces the view's latest waiting
 * one of its type (React Native's continuous category).
 */
const DISPATCH: Record<EventDelivery, (name: cpp.Expr, payload: cpp.Expr) => cpp.Expr> = {
  discrete: (name, payload) =>
    cpp.call("dispatchEvent", [
      name,
      payload,
      cpp.id("facebook::react::RawEvent::Category::Discrete"),
    ]),
  continuous: (name, payload) =>
    cpp.call("dispatchEvent", [
      name,
      payload,
      cpp.id("facebook::react::RawEvent::Category::Continuous"),
    ]),
  coalesced: (name, payload) => cpp.call("dispatchUniqueEvent", [name, payload]),
};

/**
 * `emit(EventN)`: dispatches the event with its arguments, by position (see
 * lucent::views::EventArguments), as its delivery says.
 */
function emitDefinition(e: EventDescription, params: Param[]): cpp.Decl {
  const slot = e.slot;
  const runtime = cpp.id("runtime");
  const args = cpp.id("args");
  const event = cpp.id("event");

  const factory = cpp.lambda(
    params.length ? [{ name: "event", init: cpp.call("std::move", [event]) }] : [],
    [cpp.param(RUNTIME, "runtime")],
    [
      cpp.varDecl(cpp.type("lucent::views::EventArguments"), "args"),
      ...params.map((x) =>
        cpp.exprStmt(
          cpp.call(cpp.dot(args, x.p.optional ? "addOptional" : "add"), [
            runtime,
            cpp.dot(event, x.name),
          ]),
        ),
      ),
      cpp.ret(cpp.call(cpp.dot(args, "payload"), [runtime])),
    ],
    { ret: JS_VALUE },
  );

  return {
    k: "function",
    name: "emit",
    scope: cpp.type("EventEmitter"),
    ret: cpp.voidType,
    const: true,
    params: [cpp.param(cpp.type(eventStruct(slot)), params.length ? "event" : undefined)],
    body: [cpp.exprStmt(DISPATCH[e.delivery](cpp.str(eventName(slot)), factory))],
  };
}

type Command = { command: CommandDescription; params: Param[]; result?: cpp.Type };

/** A struct per command (a request carries its id), the variant of them, and the parser. */
function commandDecls(commands: Command[]): cpp.Decl[] {
  if (!commands.length) return [];

  return [
    ...commands.flatMap((x, index): cpp.Decl[] => [
      { k: "comment", text: commandComment(x) },
      cpp.struct(commandStruct(index), [
        ...(x.command.result.kind === "request" ? [cpp.field(cpp.type("double"), "request_")] : []),
        ...x.params.map((p) => cpp.field(p.type, p.name)),
      ]),
      ...(x.result
        ? [{ k: "using", name: fabricNames.result(index), type: x.result } as cpp.Decl]
        : []),
    ]),
    {
      k: "using",
      name: "Command",
      type: cpp.type("std::variant", ...commands.map((_, index) => cpp.type(commandStruct(index)))),
    },
    {
      k: "comment",
      text: "The command JavaScript sent: throws lucent::views::Mismatch for another name or arguments.",
    },
    cpp.fn("parseCommand", cpp.type("Command"), commandParams),
    {
      k: "comment",
      text: "The request id a command carries, if it is a request: what to reject when it cannot run.",
    },
    cpp.fn("requestId", REQUEST_ID, commandParams),
  ];
}

const REQUEST_ID = cpp.type("std::optional", cpp.type("double"));

const commandParams = [
  cpp.param(constRef(cpp.type("std::string")), "name"),
  cpp.param(constRef(cpp.type("folly::dynamic")), "args"),
];

function commandComment(x: Command): string {
  const signature = `${x.command.name}(${x.command.params.map((p) => p.name).join(", ")})`;

  if (x.command.result.kind === "enqueue") return `${signature}: runs on the view's thread`;

  return `${signature}: a request, answered by id through the host's completion channel`;
}

function commandDefs(c: ComponentDescription, commands: Command[]): cpp.Decl[] {
  if (!commands.length) return [];

  const args = cpp.id("items");
  const command = cpp.id("command");
  const name = cpp.id("name");

  const branches = commands.map((x, index): cpp.Stmt => {
    const request = x.command.result.kind === "request";
    const offset = request ? 1 : 0;

    return cpp.ifStmt(cpp.binary(name, "==", cpp.str(x.command.name)), [
      cpp.varDecl(cpp.type(commandStruct(index)), "command"),
      ...(request
        ? [
            cpp.exprStmt(
              cpp.call(helper("argument"), [
                args,
                cpp.num(0),
                cpp.str("request"),
                cpp.dot(command, "request_"),
              ]),
            ),
          ]
        : []),
      ...x.params.map((p, i) =>
        cpp.exprStmt(
          cpp.call(helper(p.p.optional ? "optionalArgument" : "argument"), [
            args,
            cpp.num(i + offset),
            cpp.str(p.p.name),
            cpp.dot(command, p.name),
          ]),
        ),
      ),
      cpp.ret(command),
    ]);
  });

  const requests = commands.filter((x) => x.command.result.kind === "request");
  const first = cpp.index(cpp.id("args"), cpp.num(0));
  const hasId = cpp.and(
    cpp.call(cpp.dot(cpp.id("args"), "isArray")),
    cpp.not(cpp.call(cpp.dot(cpp.id("args"), "empty"))),
    cpp.call(cpp.dot(first, "isNumber")),
  );

  return [
    cpp.fn("requestId", REQUEST_ID, commandParams, [
      cpp.ifStmt(
        cpp.and(
          requests.length
            ? cpp.or(...requests.map((x) => cpp.binary(name, "==", cpp.str(x.command.name))))
            : cpp.bool(false),
          hasId,
        ),
        [cpp.ret(cpp.call(cpp.dot(first, "asDouble")))],
      ),
      cpp.ret(cpp.id("std::nullopt")),
    ]),
    cpp.fn("parseCommand", cpp.type("Command"), commandParams, [
      cpp.varDecl(cpp.auto, "items", cpp.call(helper("arguments"), [cpp.id("args")])),
      ...branches,
      {
        k: "throw",
        value: cpp.construct(cpp.type("lucent::views::Mismatch"), [
          cpp.binary(cpp.str(`${c.registration} has no command `), "+", name),
        ]),
      },
    ]),
  ];
}

// --- registry -------------------------------------------------------------------------

function registrySources(components: readonly ComponentDescription[]): {
  header: string;
  source: string;
} {
  const registry = cpp.param(
    constRef(
      cpp.type("std::shared_ptr", cpp.constType(react("ComponentDescriptorProviderRegistry"))),
    ),
    "registry",
  );

  const header = cpp.printUnit({
    banner: "Generated by Lucent. Do not edit.",
    decls: [
      { k: "pragmaOnce" },
      cpp.include("react/renderer/componentregistry/ComponentDescriptorProviderRegistry.h", true),
      cpp.include("memory", true),
      cpp.namespace("lucent::views", [
        {
          k: "comment",
          text: "Adds the descriptor of every component the app's Lucent code exports.",
        },
        cpp.fn("registerComponents", cpp.voidType, [registry]),
      ]),
    ],
  });

  const source = cpp.printUnit({
    banner: "Generated by Lucent. Do not edit.",
    decls: [
      cpp.include("lucent_views.h"),
      ...components.map((c) => cpp.include(`${c.registration}.h`)),
      cpp.namespace("lucent::views", [
        cpp.fn(
          "registerComponents",
          cpp.voidType,
          [registry],
          components.map((c) =>
            cpp.exprStmt(
              cpp.call(cpp.arrow(cpp.id("registry"), "add"), [
                cpp.call(
                  cpp.templateId("facebook::react::concreteComponentDescriptorProvider", [
                    cpp.type(`${c.registration}::ComponentDescriptor`),
                  ]),
                ),
              ]),
            ),
          ),
        ),
      ]),
    ],
  });

  return { header, source };
}
