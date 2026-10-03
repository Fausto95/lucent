/**
 * What a native view class takes in JSX, derived by rule from its binding
 * schema (T48): no view, prop or event is listed in Lucent. Pure: a class
 * and its module in, its own attributes out (a subclass inherits the rest
 * through its declaration's `extends`), each with the rule that made it and
 * the declaration it comes from, or why there is none.
 *
 * - Props: a writable property (iOS, Kotlin), or on Android a one-value
 *   `set<X>` method (overloads one prop, chosen by the value's type).
 * - Events: on Android, `setOn<X>Listener(L)` where L has one method:
 *   `on<X>`, a function of that method's arguments. On iOS, a class
 *   declaring `addAction:forControlEvents:` (UIControl's convention): one
 *   `on<Case>` per single-bit case of the events it takes, called with the
 *   control.
 * - Construction: iOS `initWithFrame:` (a zero frame) else `init`, its own
 *   or inherited; Android the `(Context)` constructor, given the host's
 *   context. Otherwise the element says how: `create={() => new X(…)}`.
 */
import { ownTypes, planBinding, unsupportedReason } from "./plans.ts";
import {
  parseSdkType,
  type SdkCallable,
  type SdkClassSchema,
  type SdkEnumSchema,
  type SdkMethodSchema,
  type SdkModuleSchema,
  type SdkPropertySchema,
  type SdkStructSchema,
} from "./schema.ts";

/** Another module's type, as the rules look it up (`module` is the schema's module name). */
export type FindType = (
  module: string,
  name: string,
) => SdkClassSchema | SdkEnumSchema | SdkStructSchema | undefined;

/** A prop: a writable property, or (Android) a class's one-value setters of one name. */
export type ViewProp =
  | { kind: "property"; name: string; member: SdkPropertySchema; explanation: string }
  | { kind: "setter"; name: string; overloads: SdkMethodSchema[]; explanation: string };

/** An event: a listener setter (Android), or a control event (iOS). */
export type ViewEvent =
  | {
      kind: "listener";
      name: string;
      /** `setOn<X>Listener`. */
      setter: SdkMethodSchema;
      /** The listener interface, and its one method, which the handler is. */
      listener: { module: string; name: string };
      method: SdkMethodSchema;
      explanation: string;
    }
  | {
      kind: "control";
      name: string;
      /** `addAction:forControlEvents:`, which registers it. */
      register: SdkMethodSchema;
      /** The events enum, and the case's value. */
      events: { module: string; name: string };
      value: number;
      explanation: string;
    };

export interface ViewRules {
  props: ViewProp[];
  events: ViewEvent[];
  /** Attributes the class would give, and why Lucent does not. */
  refused: { name: string; reason: string }[];
}

/** How a tag makes its view when it does not say (`create`). */
export type ViewConstruction =
  | { kind: "frame" | "init" | "context"; ctor: SdkCallable; owner: string; module: string }
  | { kind: "create"; reason: string };

const LISTENER = /^setOn([A-Z]\w*)Listener$/;
const SETTER = /^set([A-Z]\w*)$/;
const REGISTER = "addAction:forControlEvents:";

const capitalized = (s: string) => s[0]!.toUpperCase() + s.slice(1);
const decapitalized = (s: string) => s[0]!.toLowerCase() + s.slice(1);

/** Whether `value` is one bit: a single event, not a group of them (`allTouchEvents`). */
const singleBit = (value: number | string) =>
  typeof value === "number" && value > 0 && (value & (value - 1)) === 0;

/** The class or enum a type reference names, in its module or another. */
function referenced(
  type: SdkMethodSchema["params"][number]["type"],
  schema: SdkModuleSchema,
  find: FindType,
): { module: string; name: string; decl: ReturnType<FindType> } | undefined {
  if (type.k !== "ref") return undefined;

  const decl =
    type.module === schema.module
      ? schema.types.find((t) => t.name === type.name)
      : find(type.module, type.name);

  return { module: type.module, name: type.name, decl };
}

/** What `cls` itself adds to the JSX attributes of the views it is or that extend it. */
export function viewRules(cls: SdkClassSchema, schema: SdkModuleSchema, find: FindType): ViewRules {
  const types = ownTypes(schema);
  const where = schema.provenance?.artifact ?? schema.module;
  const why = (member: Parameters<typeof planBinding>[1], role: "set" | "call") =>
    unsupportedReason(planBinding(cls, member, schema, types, role));

  const props: ViewProp[] = [];
  const events: ViewEvent[] = [];
  const refused: ViewRules["refused"] = [];

  for (const p of cls.properties ?? []) {
    if (p.static || p.readonly || p.value !== undefined) continue;

    const reason = why(p, "set");
    if (reason) refused.push({ name: p.name, reason });
    else
      props.push({
        kind: "property",
        name: p.name,
        member: p,
        explanation: `${cls.name}.${p.name}: a writable property${p.setter ? ` (${p.setter})` : ""}, in ${where}`,
      });
  }

  const setters = new Map<string, SdkMethodSchema[]>();
  for (const m of cls.methods ?? []) {
    if (m.static) continue;

    const listener = LISTENER.exec(m.name);
    if (listener && m.params.length === 1) {
      const name = `on${listener[1]}`;
      const ref = referenced(m.params[0]!.type, schema, find);
      const iface = ref?.decl?.kind === "class" ? ref.decl : undefined;
      const method = iface?.functional
        ? iface.methods?.find((x) => x.name === iface.functional && x.abstract)
        : undefined;

      if (!ref || !iface || !method)
        refused.push({
          name,
          reason: `${m.name}'s listener has more than one method: set it in setup code, with an object of a class implementing it`,
        });
      else
        events.push({
          kind: "listener",
          name,
          setter: m,
          listener: { module: ref.module, name: ref.name },
          method,
          explanation: `${cls.name}.${m.name}: a listener with one method (${ref.name}.${method.name}), in ${where}`,
        });
      continue;
    }

    if (m.selector === REGISTER && m.params.length === 2) {
      const ref = referenced(m.params[1]!.type, schema, find);
      if (ref?.decl?.kind === "enum")
        for (const c of ref.decl.cases.filter((x) => singleBit(x.value)))
          events.push({
            kind: "control",
            name: `on${capitalized(c.name)}`,
            register: m,
            events: { module: ref.module, name: ref.name },
            value: c.value as number,
            explanation: `${cls.name}.${REGISTER} with ${ref.name}.${c.name}: a control event, in ${where}`,
          });
      continue;
    }

    const setter = SETTER.exec(m.name);
    if (
      schema.platform === "android" &&
      setter &&
      m.params.length === 1 &&
      m.returns.k === "prim" &&
      m.returns.name === "void"
    ) {
      const name = decapitalized(setter[1]!);
      setters.set(name, [...(setters.get(name) ?? []), m]);
    }
  }

  for (const [name, overloads] of setters) {
    if (props.some((p) => p.name === name)) continue;

    const usable = overloads.filter((m) => !why(m, "call"));
    if (!usable.length) refused.push({ name, reason: why(overloads[0]!, "call")! });
    else
      props.push({
        kind: "setter",
        name,
        overloads: usable,
        explanation: `${cls.name}.${usable[0]!.name}: a setter taking one value, in ${where}`,
      });
  }

  return { props, events, refused };
}

/** How `cls` is made without `create`: its own or (iOS) its inherited initializers. */
export function viewConstruction(
  cls: SdkClassSchema,
  schema: SdkModuleSchema,
  find: FindType,
): ViewConstruction {
  if (schema.platform === "android") {
    const ctor = (cls.constructors ?? []).find(
      (c) =>
        !c.protected &&
        c.params.length === 1 &&
        c.params[0]!.type.k === "ref" &&
        c.params[0]!.type.module === "android.content" &&
        c.params[0]!.type.name === "Context",
    );

    return ctor
      ? { kind: "context", ctor, owner: cls.name, module: schema.module }
      : { kind: "create", reason: `${cls.name} has no constructor taking only a Context` };
  }

  // An Objective-C class declaring no initializers has its superclass's.
  let owner: SdkClassSchema | undefined = cls;
  let module = schema.module;
  for (let depth = 0; owner && depth < 32; depth++) {
    const ctors = owner.constructors ?? [];
    const frame = ctors.find((c) => c.selector === "initWithFrame:");
    const plain = ctors.find((c) => c.selector === "init" && !c.params.length);

    if (frame) return { kind: "frame", ctor: frame, owner: owner.name, module };
    if (plain) return { kind: "init", ctor: plain, owner: owner.name, module };
    if (ctors.length && !owner.inheritsInit) break;
    if (!owner.extends) break;

    const sup = parseSdkType(owner.extends, module);
    if (sup.k !== "ref") break;

    const decl: ReturnType<FindType> =
      sup.module === schema.module
        ? schema.types.find((t) => t.name === sup.name)
        : find(sup.module, sup.name);
    owner = decl?.kind === "class" ? decl : undefined;
    module = sup.module;
  }

  return {
    kind: "create",
    reason: `${cls.name} has no initWithFrame: or init to make it with: say how, create={() => new ${cls.name}(…)}`,
  };
}
