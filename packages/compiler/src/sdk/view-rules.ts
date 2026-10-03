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
 * - Children: the views a class inserts at an index, by the method it
 *   declares for it: on iOS `insert<X>:atIndex:` (a stack view's
 *   `insertArrangedSubview:atIndex:`, any view's `insertSubview:atIndex:`;
 *   the nearest class's wins), on Android `addView(View, int)`.
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

/** How a class inserts the views written as its children: `insert(child, index)`. */
export interface ViewChildren {
  insert: SdkMethodSchema;
  explanation: string;
}

export interface ViewRules {
  props: ViewProp[];
  events: ViewEvent[];
  /** Whether the class itself declares how it takes children. */
  children?: ViewChildren;
  /** Attributes the class would give, and why Lucent does not. */
  refused: { name: string; reason: string }[];
}

/** How a tag makes its view when it does not say (`create`). */
export type ViewConstruction =
  | { kind: "frame" | "init" | "context"; ctor: SdkCallable; owner: string; module: string }
  | { kind: "create"; reason: string };

/** The class every view is: UIKit's UIView, Android's View. */
export const ROOT_VIEW = {
  ios: { module: "UIKit", name: "UIView" },
  android: { module: "android.view", name: "View" },
};

const LISTENER = /^setOn([A-Z]\w*)Listener$/;
const SETTER = /^set([A-Z]\w*)$/;
const REGISTER = "addAction:forControlEvents:";
const INSERT_AT = /^insert\w*:atIndex:$/;

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
  let children: ViewChildren | undefined;
  for (const m of cls.methods ?? []) {
    if (m.static) continue;

    const [child, index] = m.params;
    const inserts =
      m.params.length === 2 &&
      child!.type.k === "ref" &&
      index!.type.k === "prim" &&
      (schema.platform === "ios"
        ? !!m.selector && INSERT_AT.test(m.selector)
        : m.name === "addView" &&
          child!.type.module === ROOT_VIEW.android.module &&
          child!.type.name === ROOT_VIEW.android.name);
    if (inserts && !children) {
      children = {
        insert: m,
        explanation: `${cls.name}.${m.selector ?? m.name}: inserts a view at an index, in ${where}`,
      };
      continue;
    }

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

    // A generic setter's type is the call's to choose: an attribute gives none.
    if (overloads.every((m) => m.typeParams?.length)) {
      refused.push({
        name,
        reason: `${overloads[0]!.name} is generic: call it in setup code, which gives its type`,
      });
      continue;
    }

    const usable = overloads.filter((m) => !m.typeParams?.length && !why(m, "call"));
    if (!usable.length) refused.push({ name, reason: why(overloads[0]!, "call")! });
    else
      props.push({
        kind: "setter",
        name,
        overloads: usable,
        explanation: `${cls.name}.${usable[0]!.name}: a setter taking one value, in ${where}`,
      });
  }

  return { props, events, refused, ...(children ? { children } : {}) };
}

/**
 * Whether `cls` is a view: the root view, or a class extending it. On iOS
 * a superclass in another module is taken to be one, unread: reading it
 * means extracting that module (UIKit, minutes cold), which only names
 * other modules' types; a class of it that is no view is no JSX tag anyway.
 */
export function isViewClass(cls: SdkClassSchema, schema: SdkModuleSchema, find: FindType): boolean {
  const root = ROOT_VIEW[schema.platform];
  let owner: SdkClassSchema | undefined = cls;
  let module = schema.module;

  for (let depth = 0; owner && depth < 64; depth++) {
    if (module === root.module && owner.name === root.name) return true;
    if (owner.interface || !owner.extends) return false;

    const sup = parseSdkType(owner.extends, module);
    if (sup.k !== "ref") return false;
    if (sup.module === root.module && sup.name === root.name) return true;
    if (sup.module !== module && schema.platform === "ios") return true;

    const decl: ReturnType<FindType> =
      sup.module === schema.module
        ? schema.types.find((t) => t.name === sup.name)
        : find(sup.module, sup.name);
    owner = decl?.kind === "class" ? decl : undefined;
    module = sup.module;
  }

  return false;
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

/** A class of a tag's hierarchy: where an attribute it takes is declared. */
export interface ViewOwner {
  cls: SdkClassSchema;
  schema: SdkModuleSchema;
}

/** What a tag of `cls` takes, from it and every class above it: the nearest class's wins. */
export interface ViewTag {
  props: Map<string, { prop: ViewProp; owner: ViewOwner }>;
  events: Map<string, { event: ViewEvent; owner: ViewOwner }>;
  children?: { rule: ViewChildren; owner: ViewOwner };
  construction: ViewConstruction;
}

/**
 * The attributes a tag of `cls` takes, walking its superclasses (their
 * modules read with `moduleOf`, which a compile does: unlike declarations,
 * lowering a tag may read other modules).
 */
export function viewTag(
  cls: SdkClassSchema,
  schema: SdkModuleSchema,
  moduleOf: (module: string) => SdkModuleSchema | undefined,
): ViewTag {
  const find: FindType = (module, name) => moduleOf(module)?.types.find((t) => t.name === name);
  const props: ViewTag["props"] = new Map();
  const events: ViewTag["events"] = new Map();
  let children: ViewTag["children"];

  let owner: ViewOwner | undefined = { cls, schema };
  for (let depth = 0; owner && depth < 64; depth++) {
    const rules = viewRules(owner.cls, owner.schema, find);

    for (const prop of rules.props)
      if (!props.has(prop.name)) props.set(prop.name, { prop, owner });
    for (const event of rules.events)
      if (!events.has(event.name)) events.set(event.name, { event, owner });
    if (rules.children && !children) children = { rule: rules.children, owner };

    const root = ROOT_VIEW[schema.platform];
    if (owner.schema.module === root.module && owner.cls.name === root.name) break;
    if (!owner.cls.extends) break;

    const sup = parseSdkType(owner.cls.extends, owner.schema.module);
    const next = sup.k === "ref" ? moduleOf(sup.module) : undefined;
    const decl = sup.k === "ref" ? next?.types.find((t) => t.name === sup.name) : undefined;
    owner = next && decl?.kind === "class" ? { cls: decl, schema: next } : undefined;
  }

  return {
    props,
    events,
    ...(children ? { children } : {}),
    construction: viewConstruction(cls, schema, find),
  };
}
