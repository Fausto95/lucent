/**
 * The React side of each component, generated from its description: the
 * exports a module's JavaScript proxy adds for its components, and their
 * React-facing declarations.
 *
 * A proxy describes its component as data, and the views runtime
 * (runtime/js/views.js) makes it a React component rendering the native
 * view registered under the registration name: the props under their
 * transport keys, a nullable value boxed; each event handler adapted
 * from the native payload to the declared parameters; the ref's commands
 * sent through React Native's command dispatch; the React children of a
 * component taking them, as the native view's.
 */
import { ts as js } from "@lucent-lang/codegen";
import type { CommandDescription, ComponentDescription, ViewField, ViewType } from "./contract.ts";
import { handlerKey, propKey, topLevelEvent } from "./transport.ts";

/** The views runtime's path in the native package's js/ directory, next to the loader. */
export const VIEWS_RUNTIME = "_lucent/views.js";

/**
 * The statements a module proxy adds for `components`: the views runtime,
 * then each component's export. `up` is the proxy's way to js/ (`./`,
 * `../`…).
 */
export function componentExports(
  components: readonly ComponentDescription[],
  up: string,
): js.Decl[] {
  if (!components.length) return [];

  const require = (spec: string) => js.call(js.name("require"), [js.str(spec)]);

  return [
    js.stmt({ k: "const", name: ["lucentComponent"], init: require(`${up}${VIEWS_RUNTIME}`) }),
    ...components.map((c) =>
      js.stmt(
        js.exprStmt(
          js.assign(
            js.member(js.name("exports"), c.export),
            js.call(js.name("lucentComponent"), [
              config(c),
              // Required from the app's own location, as the loader's React Native is.
              require("react"),
              require("react-native"),
            ]),
          ),
        ),
      ),
    ),
  ];
}

/** What the views runtime needs to know about a component, as a literal. */
function config(c: ComponentDescription): js.Expr {
  const entry = (props: { key: string; value: js.Expr }[]) => js.objectLit(props);

  return js.objectLit(
    [
      { key: "name", value: js.str(c.registration) },
      { key: "displayName", value: js.str(c.export) },
      ...(c.children ? [{ key: "children", value: js.bool(true) }] : []),
      {
        key: "props",
        value: js.arrayLit(
          c.props.map((p, index) =>
            entry([
              { key: "name", value: js.str(p.name) },
              { key: "key", value: js.str(propKey(index)) },
              { key: "shape", value: shape(p.type) },
            ]),
          ),
          true,
        ),
      },
      {
        key: "events",
        value: js.arrayLit(
          c.events.map((e) =>
            entry([
              { key: "name", value: js.str(e.name) },
              { key: "key", value: js.str(handlerKey(e.slot)) },
              { key: "event", value: js.str(topLevelEvent(e.slot)) },
            ]),
          ),
          true,
        ),
      },
      {
        key: "commands",
        value: js.arrayLit(
          c.commands.map((command) =>
            entry([
              { key: "name", value: js.str(command.name) },
              { key: "request", value: js.bool(command.result.kind === "request") },
              { key: "params", value: js.arrayLit(command.params.map((p) => shape(p.type))) },
            ]),
          ),
          true,
        ),
      },
    ],
    true,
  );
}

/**
 * How the runtime encodes a value of type `t` for the native view: `0`,
 * as it is; `{ n }`, a nullable value, boxed; `{ a }`, an array's
 * elements; `{ o }`, an object's fields. Only what holds a nullable value
 * needs encoding; the rest is `0`.
 */
function shape(t: ViewType): js.Expr {
  const inner = (x: ViewType) => (boxes(x) ? shape(x) : js.num(0));

  switch (t.k) {
    case "nullable":
      return js.objectLit([{ key: "n", value: inner(t.inner) }]);
    case "array":
      return boxes(t.element) ? js.objectLit([{ key: "a", value: shape(t.element) }]) : js.num(0);
    case "object": {
      const fields = t.fields.filter((f) => boxes(f.type));

      if (!fields.length) return js.num(0);

      return js.objectLit([
        {
          key: "o",
          value: js.arrayLit(
            fields.map((f) =>
              js.objectLit([
                { key: "name", value: js.str(f.name) },
                { key: "shape", value: shape(f.type) },
              ]),
            ),
          ),
        },
      ]);
    }
    default:
      return js.num(0);
  }
}

/** Whether a value of type `t` holds a nullable value anywhere. */
function boxes(t: ViewType): boolean {
  switch (t.k) {
    case "nullable":
      return true;
    case "array":
      return boxes(t.element);
    case "object":
      return t.fields.some((f) => boxes(f.type));
    default:
      return false;
  }
}

// --- declarations ---------------------------------------------------------------------

/**
 * The React-facing declarations of `components`: each a function component
 * taking its props, the events as callbacks, its React children if it
 * takes any, the host's `style`, and a `ref` to its commands (a request
 * answers a promise).
 */
export function componentDeclarations(components: readonly ComponentDescription[]): js.Unit {
  return {
    banner: "Generated by Lucent. Do not edit.",
    decls: [
      { k: "importType", names: ["ReactNode", "Ref"], from: "react" },
      { k: "importType", names: ["StyleProp", "ViewStyle"], from: "react-native" },
      js.blank,
      ...components.map((c): js.Decl => ({
        k: "function",
        name: c.export,
        params: [js.param("props", propsType(c))],
        ret: js.ref("ReactNode"),
      })),
    ],
  };
}

function propsType(c: ComponentDescription): js.Type {
  return js.object([
    ...c.props.map((p) => member(p)),
    ...c.events.map((e) => ({
      name: e.name,
      optional: e.optional,
      type: js.fn(e.params.map(param), js.keyword("void")),
    })),
    ...(c.children
      ? [{ name: "children", optional: c.children.optional, type: js.ref("ReactNode") }]
      : []),
    { name: "style", optional: true, type: js.ref("StyleProp", js.ref("ViewStyle")) },
    ...(c.commands.length
      ? [{ name: "ref", optional: true, type: js.ref("Ref", js.object(c.commands.map(command))) }]
      : []),
  ]);
}

function command(c: CommandDescription): js.PropertySignature {
  const result =
    c.result.kind === "enqueue"
      ? js.keyword("void")
      : js.ref("Promise", c.result.value ? typeOf(c.result.value) : js.keyword("void"));

  return { name: c.name, type: js.fn(c.params.map(param), result) };
}

const member = (f: ViewField): js.PropertySignature => ({
  name: f.name,
  type: typeOf(f.type),
  optional: f.optional,
});

const param = (f: ViewField): js.Param => ({
  name: f.name,
  type: typeOf(f.type),
  optional: f.optional,
});

function typeOf(t: ViewType): js.Type {
  switch (t.k) {
    case "number":
    case "boolean":
    case "string":
      return js.keyword(t.k);
    case "enum":
      return js.union(t.values.map(js.literal));
    case "array":
      return js.array(typeOf(t.element));
    case "object":
      return js.object(t.fields.map(member));
    case "nullable":
      return js.union([typeOf(t.inner), js.nullType]);
  }
}
