/**
 * Components' setups, compiled through the semantic IR, as functions are. A setup runs once per
 * mount, on the main thread, in the mount's scope: each prop is a signal of
 * the main context's reactive graph (lucent/view.h), which effects track
 * where they read `props.name`; each event is a route the mount points at
 * its current event emitter; the object given to `expose` fills the
 * component's command table. The mount is the IR's ambient CONTENT, which
 * each function the setup makes enters when it runs.
 *
 * In the module's namespace, for a component `Meter`:
 *
 *   struct Meter_Props { Signal<L> p0_value; …; Event<A…> e0_onChange; … };
 *   struct Meter_Commands { Fn<R(A…)> c0_reset; … };
 *   lucent::NativeRef Meter_setup(Meter_Props props, Meter_Commands& commands);
 *
 * A component taking React children gets its host's slot for them too
 * (`…, lucent::NativeRef lucent_slot)`), which `slot()` in setup is.
 *
 * The generated mount glue (views/<registration>_mount.cpp) converts what
 * React commits into those signals and calls the setup.
 */
import { cpp } from "@lucent-lang/codegen";
import path from "node:path";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import { builtinSdkModuleOf, type LucentModule } from "../program.ts";
import { cppIdent, type LType, T } from "../types.ts";
import type { Platform } from "../sdk/schema.ts";
import type { ComponentDescription } from "../ui/contract.ts";
import { fabricNames } from "../ui/fabric.ts";
import { assignFieldRepr, assignRepr, fieldToLucent, toLucent } from "./view-values.ts";
import { type FunctionLike, returnShape, sdkRoot, toolkitOf } from "../ui/roots.ts";
import { type BodySetup, bodyOf, isJsx } from "../ui/toolkit-body.ts";
import type { ToolkitName } from "../ui/toolkits.ts";
import type { Ctx, E } from "./context.ts";
import type { FnEmitter } from "./function.ts";
import type { CppFunction } from "../ir/cpp.ts";
import type { IrUnit } from "./through-ir.ts";
import { liftedStatements } from "./toolkit.ts";
import { traceSite } from "./trace-site.ts";

/** A prop, an event or a command of a compiled setup: its C++ member and its Lucent type(s). */
export interface SetupProp {
  readonly name: string;
  readonly field: string;
  readonly type: LType;
}

export interface SetupEvent {
  readonly name: string;
  readonly field: string;
  readonly params: readonly LType[];
}

export interface SetupCommand {
  readonly name: string;
  readonly field: string;
  readonly type: LType & { k: "fn" };
}

/** A component whose setup this program compiles. */
export interface Setup {
  readonly component: ComponentDescription;
  readonly fn: FunctionLike;
  readonly module: LucentModule;
  /** C++ names, in the module's namespace. */
  readonly names: { readonly props: string; readonly commands: string; readonly setup: string };
  /** The props parameter's symbol, if it has one. */
  readonly propsSymbol?: ts.Symbol;
  readonly props: readonly SetupProp[];
  readonly events: readonly SetupEvent[];
  readonly commands: readonly SetupCommand[];
  /** What the setup returns: the component's root view. */
  readonly root: LType;
  /** The declarative toolkit its root view is of: it draws with a body (toolkit.ts). */
  readonly toolkit?: ToolkitName;
}

/** The C++ name of the parameter holding the command table. */
const COMMANDS = "lucent_commands";

/** The C++ name of the parameter holding the host's slot, for a component taking children. */
const SLOT = "lucent_slot";

/**
 * The C++ name of the mount's content (lucent::ui::Content) in a setup and
 * the functions it makes: the mount the host was entering when setup ran.
 */
export const CONTENT = "lucent_content";

/** Registers `component`'s setup `fn` with the program: its types, before any code is emitted. */
export function planSetup(
  ctx: Ctx,
  component: ComponentDescription,
  fn: FunctionLike,
  module: LucentModule,
): Setup {
  const checker = ctx.checker;
  const base = cppIdent(component.export);
  const names = {
    props: `${base}_Props`,
    commands: `${base}_Commands`,
    setup: `${base}_setup`,
  };

  ctx.reg.componentStructs.set(component.id, `lucent_app::${module.ns}::${names.props}`);

  const param = fn.parameters[0];
  const propsType = param && checker.getTypeAtLocation(param);
  const member = (name: string): { type: ts.Type; node: ts.Node } => {
    const symbol = propsType?.getProperty(name);

    if (!symbol) throw new Error(`the component ${component.id} has no prop ${name}`);

    return {
      type: checker.getTypeOfSymbolAtLocation(symbol, fn),
      node: symbol.valueDeclaration ?? fn,
    };
  };

  const props = component.props.map((p, i): SetupProp => {
    const { type, node } = member(p.name);
    const lowered = ctx.reg.lower(type, node);

    return { name: p.name, field: `p${i}_${cppIdent(p.name)}`, type: lowered };
  });

  const events = component.events.map((e): SetupEvent => {
    const { type, node } = member(e.name);
    const sig = checker.getNonNullableType(type).getCallSignatures()[0];

    if (!sig) throw new Error(`the event ${e.name} of ${component.id} has no signature`);

    const params = (ctx.reg.lowerSignature(sig, node) as LType & { k: "fn" }).params;

    return { name: e.name, field: `e${e.slot}_${cppIdent(e.name)}`, params };
  });

  const exposed = exposedObject(checker, fn);
  const commands = component.commands.map((c, i): SetupCommand => {
    const property = exposed?.properties.find((p) => p.name && propertyName(p.name) === c.name);

    if (!property) throw new Error(`the command ${c.name} of ${component.id} is not exposed`);

    const sig = checker.getTypeAtLocation(property).getCallSignatures()[0];

    if (!sig) throw new Error(`the command ${c.name} of ${component.id} has no signature`);

    const type = ctx.reg.lowerSignature(sig, property) as LType & { k: "fn" };

    return { name: c.name, field: `c${i}_${cppIdent(c.name)}`, type };
  });

  const root = ctx.reg.lower(rootType(checker, fn, ctx.platform), fn);
  const propsSymbol = param && checker.getSymbolAtLocation(param.name);
  const described = ctx.platform && component.platforms[ctx.platform]?.root;
  const toolkit = described && toolkitOf(described);

  if (propsSymbol) wholeProps(checker, fn, propsSymbol, component.export);

  const setup: Setup = {
    component,
    fn,
    module,
    names,
    ...(propsSymbol ? { propsSymbol } : {}),
    props,
    events,
    commands,
    root,
    ...(toolkit ? { toolkit } : {}),
  };

  ctx.setups.set(fn, setup);

  return setup;
}

/**
 * The type a setup returns: the root view class the target's own code
 * returns, which the component's description names (returnShape), where
 * its signature's mixes in other code: a one-file component's return type
 * is the union of each platform's view, or `any` where another platform's
 * SDK is missing here (its views untyped).
 */
function rootType(
  checker: ts.TypeChecker,
  fn: FunctionLike,
  platform: Platform | undefined,
): ts.Type {
  const declared = checker.getReturnTypeOfSignature(checker.getSignatureFromDeclaration(fn)!);

  if (!(declared.flags & ts.TypeFlags.Any) && !declared.isUnion()) return declared;

  const shape = returnShape(checker, fn, platform, sdkRoot);
  const symbol =
    shape.kind === "view" && shape.root.name && checker.getSymbolAtLocation(shape.root.name);

  return symbol ? checker.getDeclaredTypeOfSymbol(symbol) : declared;
}

/**
 * The props and commands structs and the setup function, its code lowered
 * by `lower` (through the IR): declarations for the module's header, the
 * definition for its unit.
 */
export function emitSetup(
  ctx: Ctx,
  setup: Setup,
  lower: (unit: IrUnit) => CppFunction,
): { decls: cpp.Decl[]; defs: cpp.Decl[] } {
  const reg = ctx.reg;
  const { names, fn } = setup;
  const ns = cpp.type(setup.module.ns);

  // A toolkit's component returns its body, the host it makes, and its code is checked against
  // what the body takes: both before any of its code is lowered.
  if (setup.toolkit) bodyOf(fn, setup.toolkit, ctx.checker);

  liftedStatements(ctx.checker, setup);

  const propsStruct = cpp.struct(names.props, [
    ...setup.props.map((p) =>
      cpp.field(cpp.type("lucent::ui::Signal", reg.cppType(p.type)), p.field),
    ),
    ...setup.events.map((e) =>
      cpp.field(
        // An event without arguments is Event<>: a template-id needs its angle brackets.
        e.params.length
          ? cpp.type("lucent::ui::Event", ...e.params.map((t) => reg.cppType(t)))
          : cpp.type("lucent::ui::Event<>"),
        e.field,
      ),
    ),
  ]);
  const commandsStruct = cpp.struct(
    names.commands,
    setup.commands.map((c) => cpp.field(reg.cppType(c.type), c.field)),
  );

  const props: LType = { k: "props", component: setup.component.id };
  const lowered = lower({
    decl: fn,
    id: `${setup.module.ns}::${names.setup}`,
    params: [{ name: "props", type: props, cppType: props, optional: false, rest: false }],
    result: setup.root,
    async: false,
    generic: false,
    opts: { module: setup.module, async: false },
    site: setup.component.export,
    ambient: [{ name: CONTENT, type: { k: "mount" }, spelled: CONTENT }],
  });
  // The props are the IR's parameter; the command table and the slot, names its leaves use.
  const params = [
    ...lowered.params,
    cpp.param(cpp.reference(cpp.type(names.commands)), COMMANDS),
    ...(setup.component.children ? [cpp.param(cpp.type("lucent::NativeRef"), SLOT)] : []),
  ];
  const content = cpp.varDecl(cpp.auto, CONTENT, cpp.call("lucent::ui::activeContent"));
  const body = lowered.ambient.includes(CONTENT) ? [content, ...lowered.body] : lowered.body;

  return {
    decls: [propsStruct, commandsStruct, cpp.fn(names.setup, lowered.ret, params)],
    defs: [cpp.fn(names.setup, lowered.ret, params, body, { scope: ns })],
  };
}

// --- lowering inside setups ------------------------------------------------------------

/** The setup `node` is part of (its code, or a function it creates). */
export function setupOf(ctx: Ctx, node: ts.Node): Setup | undefined {
  for (let n: ts.Node | undefined = node; n; n = n.parent) {
    const found = ctx.setups.get(n);
    if (found) return found;
  }

  return undefined;
}

/** The mount's content, read by code of a setup at `node`: the functions on the way capture it. */
export function mountContent(em: FnEmitter, node: ts.Node): cpp.Expr {
  return em.ambient(CONTENT, node).c;
}

/**
 * `lambda`, a function a plan makes at `node`: made in a setup, it enters
 * its mount whenever it runs (whoever calls it: the platform, an effect
 * run, a command), so the host hears that the mount's code ran and
 * measures what it may have changed (lucent/view.h). The IR's closures
 * enter it themselves (ir.ts `closure`).
 */
export function enterMount(em: FnEmitter, node: ts.Node, lambda: cpp.Expr): cpp.Expr {
  return setupOf(em.ctx, node)
    ? cpp.call("lucent::ui::inContent", [mountContent(em, node), lambda])
    : lambda;
}

/** A call of one of lucent:ui's helpers, lowered; undefined for any other call. */
export function uiCall(em: FnEmitter, node: ts.CallExpression): E | undefined {
  const helper = uiHelper(em.checker, node.expression);
  if (!helper) return undefined;

  const setup = setupOf(em.ctx, node);

  if (!setup)
    fail(
      node,
      Codes.ComponentContract,
      `${helper} is for a component's setup: call it in an exported function of a .lucent.tsx module that returns a view, or in a function that setup creates`,
    );

  const [arg] = node.arguments;
  const graph = cpp.call("lucent::ui::mainGraph");
  const fnArg = (): ts.ArrowFunction | ts.FunctionExpression => {
    const f = arg && skipParentheses(arg);

    if (!f || !(ts.isArrowFunction(f) || ts.isFunctionExpression(f)) || node.arguments.length !== 1)
      fail(node, Codes.UnsupportedCall, `${helper} takes one function literal: ${helper}(() => …)`);

    return f;
  };

  switch (helper) {
    case "effect":
      return {
        c: cpp.call("lucent::ui::effect", [
          graph,
          em.closure(fnArg()).c,
          cpp.str(site(node)),
          traceSite("effect", node),
        ]),
        t: T.undefined,
      };

    case "onDispose":
      return {
        c: cpp.call(cpp.arrow(graph, "onCleanup"), [em.closure(fnArg()).c]),
        t: T.undefined,
      };

    case "invalidateSize":
      if (node.arguments.length)
        fail(node, Codes.UnsupportedCall, "invalidateSize takes no arguments");

      return {
        c: cpp.call("lucent::ui::invalidateSize", [mountContent(em, node)]),
        t: T.undefined,
      };

    case "signal": {
      const t = em.lt(node);
      if (t.k !== "signal") throw new Error("signal() is not a Signal");
      if (!arg || node.arguments.length !== 1)
        fail(node, Codes.UnsupportedCall, "signal takes the initial value: signal(0)");

      return {
        c: cpp.call(
          "lucent::ui::signal",
          [graph, em.exprAs(arg, t.inner)],
          [em.reg.cppType(t.inner)],
        ),
        t,
      };
    }

    // A body's writer lowers it where a view takes it: anywhere else there is no view.
    case "bind":
      fail(
        node,
        Codes.ToolkitBody,
        'bind(signal) gives a view of a body its value and the signal\'s changes: write it where the view takes them, `TextField("…", { text: bind(draft) })`',
      );

    case "range":
      fail(
        node,
        Codes.ToolkitBody,
        "range(from, to) is written where a view takes it, its bounds the view's: `Slider({ value: bind(level), in: range(0, 10) })`",
      );

    // Where it may be called, and of which class, the view analysis checked.
    case "slot":
      return { c: cpp.id(SLOT), t: em.lt(node) };

    case "expose": {
      const literal = arg && skipParentheses(arg);
      if (!literal || !ts.isObjectLiteralExpression(literal))
        fail(node, Codes.ComponentContract, "expose takes an object literal of commands");

      // Each command's function, in the order the literal gives them, fills its entry of the table.
      const entries = literal.properties.flatMap((p) => {
        const command = setup.commands.find((c) => p.name && propertyName(p.name) === c.name);

        if (!command) return [];

        const value = ts.isPropertyAssignment(p)
          ? em.exprAs(p.initializer, command.type)
          : ts.isShorthandPropertyAssignment(p)
            ? em.exprAs(p.name, command.type)
            : fail(p, Codes.ComponentContract, `write the command as \`${command.name}: () => …\``);

        return [cpp.assign(cpp.dot(cpp.id(COMMANDS), command.field), value)];
      });

      if (!entries.length) return { c: cpp.id("lucent::undefined"), t: T.undefined };

      return { c: entries.reduce((all, e) => cpp.comma(all, e)), t: T.void };
    }
  }
}

/** `props.name` in a setup: the prop's signal, read (tracked inside an effect). */
export function propMember(em: FnEmitter, obj: E, name: string, node: ts.Node): E {
  if (obj.t.k !== "props") throw new Error("not a component's props");

  const setup = [...em.ctx.setups.values()].find(
    (s) => s.component.id === (obj.t as { component: string }).component,
  )!;
  const prop = setup.props.find((p) => p.name === name);

  if (prop) {
    if (readOnce(setup, node))
      em.ctx.warn(
        node,
        Codes.ComponentContract,
        `\`props.${name}\` is read once, while \`${setup.component.export}\` sets up: later commits never reach what it gives the value to. Read it inside \`effect(() => …)\`, or in the handler that needs it`,
      );

    return { c: cpp.call(cpp.dot(cpp.dot(obj.c, prop.field), "get")), t: prop.type };
  }

  if (name === "children" && setup.component.children)
    fail(
      node,
      Codes.ComponentContract,
      `\`props.children\` are React's: React Native mounts them in the view \`slot()\` gave \`${setup.component.export}\`, and setup never reads them`,
    );

  if (setup.events.some((e) => e.name === name))
    fail(
      node,
      Codes.ComponentContract,
      `\`props.${name}\` is an event: JavaScript handles it later, so it gives no value back and is not a function here. Call it where the event happens (\`props.${name}?.(…)\`), and give the view what it needs as a prop`,
    );

  fail(node, Codes.ComponentContract, `\`${setup.component.export}\` has no prop \`${name}\``);
}

/** The event `node` sends: `props.onChange(…)` or `props.onChange?.(…)` in a setup. */
function eventOf(ctx: Ctx, node: ts.CallExpression): SetupEvent | undefined {
  const callee = skipParentheses(node.expression);
  if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression))
    return undefined;

  const symbol = ctx.checker.getSymbolAtLocation(callee.expression);
  const setup = symbol && setupOf(ctx, node);

  if (!setup || setup.propsSymbol !== symbol) return undefined;

  return setup.events.find((e) => e.name === callee.name.text);
}

/** Whether `node` sends an event: a call, not of a value the code could test. */
export function isEventCall(ctx: Ctx, node: ts.CallExpression): boolean {
  return eventOf(ctx, node) !== undefined;
}

/** `props.onChange(…)` or `props.onChange?.(…)` in a setup: sends the event; undefined for any other call. */
export function eventCall(em: FnEmitter, node: ts.CallExpression): E | undefined {
  const event = eventOf(em.ctx, node);
  if (!event) return undefined;

  const callee = skipParentheses(node.expression) as ts.PropertyAccessExpression;
  // The props, then the arguments: JavaScript's order.
  const props = em.expr(callee.expression).c;
  const args = event.params.map((t, i) => {
    const given = node.arguments[i];

    return given ? em.exprAs(given, t) : cpp.construct(em.reg.cppType(t), [], true);
  });

  return { c: cpp.call(cpp.dot(props, event.field), args), t: T.undefined };
}

/** `signal.get()`, `.peek()`, `.set(value)`. */
export function signalMethod(em: FnEmitter, obj: E, name: string, node: ts.CallExpression): E {
  if (obj.t.k !== "signal") throw new Error("not a signal");

  const inner = obj.t.inner;

  switch (name) {
    case "get":
    case "peek":
      return { c: cpp.call(cpp.dot(obj.c, name)), t: inner };
    case "set": {
      const [value] = node.arguments;
      if (!value) fail(node, Codes.UnsupportedCall, "set takes the new value");

      return { c: cpp.call(cpp.dot(obj.c, "set"), [em.exprAs(value, inner)]), t: T.undefined };
    }
  }

  fail(node, Codes.UnsupportedCall, `${name} is not a method of Signal: use get, peek or set`);
}

/**
 * How a platform callback of a function made at `node` enters Lucent code.
 * Made in a setup (a view's native subscription), it runs in the main
 * context, never holding an actor's lock: now when the platform waits for
 * it (`callNowIn`), else as a turn of that context (`postTo`). Anywhere
 * else it enters its module's actor (`callNow`, `postCallback`).
 */
export function callbackEntry(
  em: FnEmitter,
  node: ts.Node,
): { now: (f: cpp.Expr) => cpp.Expr; later: (f: cpp.Expr) => cpp.Expr } {
  if (!setupOf(em.ctx, node)) {
    // The actor of the module the function is in.
    const actor = () => em.ctx.actorAt(node);

    return {
      now: (f) => cpp.call("lucent::callNow", [actor(), f]),
      later: (f) => cpp.call("lucent::postCallback", [actor(), f]),
    };
  }

  const main = () => cpp.call("lucent::ExecutionContext::main");

  return {
    now: (f) => cpp.call("lucent::callNowIn", [main(), f]),
    later: (f) => cpp.call("lucent::postTo", [main(), f]),
  };
}

// --- helpers ---------------------------------------------------------------------------

/** Whether code at `node` runs only while the setup runs: in the setup's own body. */
function readOnce(setup: Setup, node: ts.Node): boolean {
  for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
    // A toolkit body's values are its slots, each an effect.
    if (isJsx(n)) return false;

    if (n === setup.fn) return true;
    if (ts.isFunctionLike(n)) return false;
  }

  return false;
}

/** Uses of a setup's props parameter other than reading one prop (`props.name`). */
function wholeProps(
  checker: ts.TypeChecker,
  fn: FunctionLike,
  props: ts.Symbol,
  component: string,
): void {
  const visit = (n: ts.Node): void => {
    if (
      ts.isIdentifier(n) &&
      n !== fn.parameters[0]?.name &&
      checker.getSymbolAtLocation(n) === props &&
      !(ts.isPropertyAccessExpression(n.parent) && n.parent.expression === n)
    )
      fail(
        n,
        Codes.ComponentContract,
        `\`${component}\` uses \`${n.text}\` as a whole: setup runs once, so a copy of the props would keep their first values. Read each prop where it is used (\`${n.text}.value\`)`,
      );

    ts.forEachChild(n, visit);
  };

  if (fn.body) visit(fn.body);
}

const HELPERS = [
  "effect",
  "signal",
  "expose",
  "onDispose",
  "slot",
  "invalidateSize",
  "bind",
  "range",
] as const;

type Helper = (typeof HELPERS)[number];

const isHelper = (name: string): name is Helper => (HELPERS as readonly string[]).includes(name);

function uiHelper(checker: ts.TypeChecker, callee: ts.Expression): Helper | undefined {
  const e = skipParentheses(callee);
  if (!ts.isIdentifier(e)) return undefined;

  const found = checker.getSymbolAtLocation(e);
  const symbol =
    found && found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;
  const decl = symbol?.declarations?.[0];

  if (!decl || builtinSdkModuleOf(decl.getSourceFile()) !== "lucent:ui") return undefined;

  return isHelper(symbol.name) ? symbol.name : undefined;
}

/** The object literal a setup gives expose, at its top level. */
function exposedObject(
  checker: ts.TypeChecker,
  fn: FunctionLike,
): ts.ObjectLiteralExpression | undefined {
  const body = fn.body;
  if (!body || !ts.isBlock(body)) return undefined;

  for (const s of body.statements) {
    if (!ts.isExpressionStatement(s) || !ts.isCallExpression(s.expression)) continue;

    const arg = s.expression.arguments[0];

    if (uiHelper(checker, s.expression.expression) === "expose" && arg) {
      const literal = skipParentheses(arg);
      if (ts.isObjectLiteralExpression(literal)) return literal;
    }
  }

  return undefined;
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : undefined;
}

/** `file:line` of `node`, naming an effect in reports. */
export function site(node: ts.Node): string {
  const sf = node.getSourceFile();
  const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));

  return `${path.basename(sf.fileName)}:${line + 1}`;
}

function skipParentheses(e: ts.Expression): ts.Expression {
  let out = e;

  while (ts.isParenthesizedExpression(out) || ts.isNonNullExpression(out)) out = out.expression;

  return out;
}

// --- the mount glue --------------------------------------------------------------------

/**
 * views/<registration>_mount.cpp: the component's Mount (declared in its
 * Fabric header), which converts React's commits into the setup's signals,
 * its events into the host's, and its commands into the setup's table.
 */
export function mountUnit(ctx: Ctx, s: Setup): { name: string; text: string } {
  const reg = ctx.reg;
  const c = s.component;
  const names = {
    props: fabricNames.values(c),
    events: c.events.map((e) => fabricNames.event(e)),
    commands: c.commands.map((command, i) => fabricNames.command(command, i)),
  };
  const ns = `lucent_app::${s.module.ns}`;
  const where = cpp.str(`${path.basename(c.source.file)}:${c.source.line}`);
  const id = cpp.str(c.id);
  const view = (e: cpp.Expr, what: string) =>
    cpp.exprStmt(cpp.call("lucent::ui::reportViewError", [e, id, cpp.str(what), where]));

  const state = cpp.id("state");
  const at = (name: string) => cpp.arrow(state, name);
  const weak = cpp.id("weak");
  const MOUNT_STATE = cpp.type("MountState");
  const current = cpp.call("std::current_exception");
  const lockState = cpp.varDecl(cpp.auto, "state", cpp.call(cpp.dot(weak, "lock")));

  const stateStruct = cpp.struct("MountState", [
    cpp.field(cpp.type("std::shared_ptr", cpp.type("lucent::ui::Graph")), "graph"),
    cpp.field(cpp.type("std::shared_ptr", cpp.type("lucent::Scope")), "scope"),
    cpp.field(cpp.type("std::shared_ptr", cpp.type("lucent::ui::PropInbox")), "inbox"),
    cpp.field(cpp.type(`${ns}::${s.names.props}`), "props"),
    cpp.field(cpp.type(`${ns}::${s.names.commands}`), "commands"),
    cpp.field(cpp.type("lucent::NativeRef"), "view"),
    cpp.field(cpp.type("Emit"), "emit"),
    cpp.field(cpp.type("std::bitset", cpp.num(c.events.length)), "handlers"),
    cpp.field(cpp.type("bool"), "disposed", { init: cpp.bool(false) }),
    cpp.field(cpp.type("size_t"), "record", { init: cpp.num(0) }),
    ...(owesAnswers(s)
      ? [
          {
            k: "comment",
            text: "The requests a command's promise answers later, by id: each answered once.",
          } as cpp.Member,
          cpp.field(cpp.type("std::map", cpp.type("double"), RESPOND), "requests"),
        ]
      : []),
  ]);

  // A committed prop as a Lucent value: missing is undefined, or a TypeError for a prop that must be given.
  const propValue = (i: number, props: cpp.Expr) => {
    const p = c.props[i]!;
    const lt = s.props[i]!.type;
    const r = cpp.dot(cpp.dot(props, "values"), names.props[i]!);

    return p.optional
      ? fieldToLucent(ctx, p, lt, r)
      : toLucent(
          ctx,
          p.type,
          lt,
          cpp.call("lucent::views::required", [r, cpp.str(`${c.export}'s prop ${p.name}`)]),
        );
  };

  // create: the signals, the events' routes, then setup, once.
  const routes = s.events.map((e, i) => {
    const described = c.events[i]!;
    const slot = described.slot;
    const event = cpp.id("event");
    const args = e.params.map((t, j) => cpp.param(reg.cppType(t), `a${j}`));
    const fields = names.events[i]!.flatMap((field, j) =>
      assignFieldRepr(
        ctx,
        cpp.dot(event, field),
        described.params[j]!,
        e.params[j]!,
        cpp.id(`a${j}`),
      ),
    );

    return cpp.exprStmt(
      cpp.call(cpp.dot(cpp.dot(at("props"), e.field), "route"), [
        cpp.lambda(["weak"], args, [
          lockState,
          cpp.ifStmt(
            cpp.or(
              cpp.not(state),
              at("disposed"),
              cpp.not(cpp.call(cpp.dot(at("handlers"), "test"), [cpp.num(slot)])),
              cpp.not(at("emit")),
            ),
            [cpp.ret()],
          ),
          cpp.varDecl(cpp.type(fabricNames.eventStruct(slot)), "event"),
          ...fields,
          cpp.exprStmt(
            cpp.call(at("emit"), [
              cpp.construct(cpp.type("Event"), [cpp.call("std::move", [event])]),
            ]),
          ),
        ]),
      ]),
    );
  });

  const slot = c.children ? [cpp.id("slot")] : [];
  const setupCall = cpp.call(`${ns}::${s.names.setup}`, [at("props"), at("commands"), ...slot]);
  const create = cpp.fn(
    "create",
    cpp.type("std::shared_ptr", cpp.type("Mount")),
    [
      cpp.param(constRef(cpp.type("Props")), "props"),
      cpp.param(cpp.type("Emit"), "emit"),
      ...(c.children ? [cpp.param(cpp.type("lucent::NativeRef"), "slot")] : []),
    ],
    [
      enterMain(),
      cpp.varDecl(cpp.auto, "mount", cpp.call("std::make_shared", [], [cpp.type("Mount")])),
      cpp.varDecl(cpp.auto, "state", cpp.call("std::make_shared", [], [MOUNT_STATE])),
      cpp.exprStmt(cpp.assign(cpp.arrow(cpp.id("mount"), "state_"), state)),
      cpp.exprStmt(cpp.assign(at("graph"), cpp.call("lucent::ui::mainGraph"))),
      cpp.exprStmt(
        cpp.assign(
          at("scope"),
          cpp.call("lucent::Scope::create", [
            cpp.num(0),
            cpp.call(cpp.dot(cpp.call("lucent::ExecutionContext::main"), "root")),
          ]),
        ),
      ),
      cpp.exprStmt(
        cpp.assign(
          at("inbox"),
          cpp.call("lucent::ui::PropInbox::create", [at("graph"), at("scope")]),
        ),
      ),
      cpp.exprStmt(cpp.assign(at("emit"), cpp.call("std::move", [cpp.id("emit")]))),
      cpp.exprStmt(cpp.assign(at("handlers"), cpp.dot(cpp.id("props"), "handlers"))),
      cpp.varDecl(cpp.type("std::weak_ptr", MOUNT_STATE), "weak", state),
      ...routes,
      // A prop that does not convert (a required one missing) fails the setup, as it would throw there.
      {
        k: "try",
        body: [
          ...s.props.map((p, i) =>
            cpp.exprStmt(
              cpp.assign(
                cpp.dot(at("props"), p.field),
                cpp.call(
                  "lucent::ui::signal",
                  [at("graph"), propValue(i, cpp.id("props"))],
                  [reg.cppType(p.type)],
                ),
              ),
            ),
          ),
          cpp.exprStmt(
            cpp.assign(
              at("view"),
              cpp.call(cpp.arrow(at("graph"), "within"), [
                at("scope"),
                cpp.lambda(
                  ["&"],
                  [],
                  [
                    cpp.ret(
                      cpp.call(cpp.arrow(at("graph"), "transaction"), [
                        cpp.lambda(["&"], [], [cpp.ret(setupCall)]),
                      ]),
                    ),
                  ],
                ),
              ]),
            ),
          ),
        ],
        catches: [
          {
            body: [
              view(current, "setup"),
              cpp.exprStmt(cpp.call(cpp.arrow(cpp.id("mount"), "dispose"))),
            ],
          },
        ],
      },
      // Live, for a debug build's snapshot: its component, its setup's source and its view now.
      cpp.ifStmt(cpp.not(at("disposed")), [
        cpp.exprStmt(
          cpp.assign(
            at("record"),
            cpp.call("lucent::ui::addMount", [
              cpp.initList([
                id,
                where,
                cpp.lambda(
                  ["weak"],
                  [],
                  [
                    cpp.varDecl(cpp.auto, "live", cpp.call(cpp.dot(weak, "lock"))),
                    cpp.ret(
                      cpp.conditional(
                        cpp.id("live"),
                        cpp.arrow(cpp.id("live"), "view"),
                        cpp.construct(cpp.type("lucent::NativeRef")),
                      ),
                    ),
                  ],
                ),
              ]),
            ]),
          ),
        ),
      ]),
      cpp.ret(cpp.id("mount")),
    ],
    { scope: cpp.type("Mount") },
  );

  // update: what changed, as one commit of the props' inbox.
  const commit = cpp.id("commit");
  const changed = cpp.id("changed");
  const push = (field: number, body: cpp.Stmt[], captures: cpp.Capture[]) =>
    cpp.exprStmt(
      cpp.call(cpp.dot(commit, "push_back"), [
        cpp.initList([cpp.num(field), cpp.lambda(captures, [], body)]),
      ]),
    );
  const update = cpp.fn(
    "update",
    cpp.voidType,
    [
      cpp.param(constRef(cpp.type("Props")), "props"),
      cpp.param(constRef(cpp.type("Props")), "previous"),
    ],
    [
      cpp.varDecl(cpp.auto, "state", cpp.id("state_")),
      cpp.ifStmt(cpp.not(state), [cpp.ret()]),
      cpp.varDecl(
        cpp.auto,
        "changed",
        cpp.call(cpp.dot(cpp.id("props"), "changed"), [cpp.id("previous")]),
      ),
      cpp.varDecl(cpp.type("lucent::ui::PropInbox::Commit"), "commit"),
      // A prop that does not convert is reported, and the rest of the commit applies.
      ...s.props.map((p, i) =>
        cpp.ifStmt(cpp.call(cpp.dot(changed, "test"), [cpp.num(i)]), [
          {
            k: "try",
            body: [
              push(
                i,
                [cpp.exprStmt(cpp.call(cpp.dot(cpp.id("signal"), "set"), [cpp.id("value")]))],
                [
                  { name: "signal", init: cpp.dot(at("props"), p.field) },
                  { name: "value", init: propValue(i, cpp.id("props")) },
                ],
              ),
            ],
            catches: [{ body: [view(current, `prop ${p.name}`)] }],
          },
        ]),
      ),
      cpp.varDecl(cpp.type("std::weak_ptr", MOUNT_STATE), "weak", state),
      push(
        s.props.length,
        [
          lockState,
          cpp.ifStmt(state, [cpp.exprStmt(cpp.assign(at("handlers"), cpp.id("handlers")))]),
        ],
        ["weak", { name: "handlers", init: cpp.dot(cpp.id("props"), "handlers") }],
      ),
      cpp.exprStmt(cpp.call(cpp.arrow(at("inbox"), "post"), [cpp.call("std::move", [commit])])),
      cpp.ifStmt(cpp.call(cpp.dot(cpp.call("lucent::ExecutionContext::main"), "onExecutor")), [
        enterMain(),
        cpp.exprStmt(cpp.call(cpp.arrow(at("inbox"), "drain"))),
      ]),
    ],
    { scope: cpp.type("Mount") },
  );

  const setEmit = cpp.fn(
    "setEmit",
    cpp.voidType,
    [cpp.param(cpp.type("Emit"), "emit")],
    [
      cpp.ifStmt(cpp.and(cpp.id("state_"), cpp.not(cpp.arrow(cpp.id("state_"), "disposed"))), [
        cpp.exprStmt(
          cpp.assign(cpp.arrow(cpp.id("state_"), "emit"), cpp.call("std::move", [cpp.id("emit")])),
        ),
      ]),
    ],
    { scope: cpp.type("Mount") },
  );

  const viewFn: cpp.Decl = {
    k: "function",
    name: "view",
    scope: cpp.type("Mount"),
    ret: cpp.type("lucent::NativeRef"),
    params: [],
    const: true,
    body: [
      cpp.ret(
        cpp.conditional(
          cpp.id("state_"),
          cpp.arrow(cpp.id("state_"), "view"),
          cpp.construct(cpp.type("lucent::NativeRef")),
        ),
      ),
    ],
  };

  const dispose = cpp.fn(
    "dispose",
    cpp.voidType,
    [],
    [
      cpp.varDecl(cpp.auto, "state", cpp.id("state_")),
      cpp.ifStmt(cpp.or(cpp.not(state), at("disposed")), [cpp.ret()]),
      enterMain(),
      cpp.exprStmt(cpp.assign(at("disposed"), cpp.bool(true))),
      cpp.exprStmt(cpp.call("lucent::ui::removeMount", [at("record")])),
      cpp.exprStmt(cpp.call(cpp.arrow(at("inbox"), "close"))),
      cpp.varDecl(
        cpp.auto,
        "errors",
        cpp.call(cpp.arrow(at("graph"), "transaction"), [
          cpp.lambda(["&"], [], [cpp.ret(cpp.call(cpp.arrow(at("scope"), "dispose")))]),
        ]),
      ),
      cpp.ifStmt(cpp.id("errors"), [view(cpp.id("errors"), "dispose")]),
      // Nothing reaches the host afterwards: the routes it gave go, and so does the view.
      ...s.events.map((e) =>
        cpp.exprStmt(cpp.call(cpp.dot(cpp.dot(at("props"), e.field), "route"), [cpp.nullptr])),
      ),
      cpp.exprStmt(cpp.assign(at("emit"), cpp.nullptr)),
      cpp.exprStmt(cpp.assign(at("view"), cpp.construct(cpp.type("lucent::NativeRef")))),
      ...(owesAnswers(s)
        ? [
            cpp.varDecl(cpp.auto, "unanswered", cpp.call("std::move", [at("requests")])),
            cpp.exprStmt(cpp.call(cpp.dot(at("requests"), "clear"))),
            {
              k: "forRange",
              type: cpp.reference(cpp.auto),
              name: "owed",
              range: cpp.id("unanswered"),
              body: [
                cpp.exprStmt(
                  cpp.call(cpp.dot(cpp.id("owed"), "second"), [
                    cpp.construct(
                      cpp.type("lucent::views::Answer"),
                      [
                        cpp.dot(cpp.id("owed"), "first"),
                        cpp.construct(cpp.type("std::string"), [
                          cpp.str(`${c.export} unmounted before answering`),
                        ]),
                      ],
                      true,
                    ),
                  ]),
                ),
              ],
            } as cpp.Stmt,
          ]
        : []),
    ],
    { scope: cpp.type("Mount") },
  );

  const decls: cpp.Decl[] = [stateStruct, create, viewFn, update, setEmit, dispose];

  if (s.commands.length) decls.push(commandFn(ctx, s, names.commands, view));

  const text = cpp.printUnit({
    banner: `Generated by Lucent from ${c.id}. Do not edit.`,
    decls: [
      cpp.include(`${c.registration}.h`),
      cpp.include("LucentViewValues.h"),
      cpp.include(`../${s.module.ns}.h`),
      cpp.withoutMacros(
        [...new Set([...names.props, ...names.events.flat(), ...names.commands.flat()])].sort(),
        [cpp.namespace(`lucent::views::${c.registration}`, decls)],
      ),
    ],
  });

  return { name: `views/${c.registration}_mount.cpp`, text };
}

/** Mount::command: after the pending props, the command's function from the setup's table. */
function commandFn(
  ctx: Ctx,
  s: Setup,
  params: readonly (readonly string[])[],
  view: (e: cpp.Expr, what: string) => cpp.Stmt,
): cpp.Decl {
  const state = cpp.id("state");
  const at = (name: string) => cpp.arrow(state, name);
  const lockState = cpp.varDecl(cpp.auto, "state", cpp.call(cpp.dot(cpp.id("weak"), "lock")));
  const c = cpp.id("c");
  const respond = cpp.id("respond");
  const request = cpp.id("request");
  const current = cpp.call("std::current_exception");

  const branches = s.commands.map((command, i): cpp.Stmt => {
    const described = s.component.commands[i]!;
    const args = command.type.params.map((t, j) =>
      fieldToLucent(ctx, described.params[j]!, t, cpp.arrow(c, params[i]![j]!)),
    );
    const call = cpp.call(cpp.dot(at("commands"), command.field), args);

    const body: cpp.Stmt[] =
      described.result.kind === "enqueue"
        ? [
            cpp.ifStmt(at("disposed"), [cpp.ret()]),
            {
              k: "try",
              body: [cpp.exprStmt(call)],
              catches: [{ body: [view(current, `command ${command.name}`)] }],
            },
          ]
        : requestBody(command, i, call);

    return {
      k: "if",
      test: cpp.call("std::get_if", [cpp.addressOf(cpp.id("command"))], [cpp.type(`Command${i}`)]),
      bind: { type: cpp.auto, name: "c" },
      body: [
        ...(args.length ? [] : [cpp.exprStmt(cpp.cast("static", cpp.voidType, c))]),
        ...body,
        cpp.ret(),
      ],
    };
  });

  function requestBody(command: SetupCommand, index: number, call: cpp.Expr): cpp.Stmt[] {
    const ret = command.type.ret;
    const promised = ret.k === "promise";
    const lt = promised ? ret.inner : ret;
    const described = s.component.commands[index]!.result;
    const value = described.kind === "request" ? described.value : undefined;
    const nothing = !value;
    const runtime = cpp.param(cpp.reference(cpp.type("facebook::jsi::Runtime")), "runtime");
    const ANSWER = cpp.type("lucent::views::Answer");

    // The answer, in the renderer's type (ResultN), made a JavaScript value on the JS thread.
    const answer = (to: cpp.Expr, v?: cpp.Expr): cpp.Stmt[] =>
      v && value
        ? [
            cpp.varDecl(cpp.type(fabricNames.result(index)), "answer"),
            ...assignRepr(ctx, cpp.id("answer"), value, lt, v),
            cpp.exprStmt(
              cpp.call(to, [
                cpp.construct(
                  ANSWER,
                  [
                    request,
                    cpp.id("std::nullopt"),
                    cpp.lambda(
                      ["answer"],
                      [runtime],
                      [
                        cpp.ret(
                          cpp.call("lucent::views::toJsValue", [
                            cpp.id("runtime"),
                            cpp.id("answer"),
                          ]),
                        ),
                      ],
                    ),
                  ],
                  true,
                ),
              ]),
            ),
          ]
        : [
            cpp.exprStmt(
              cpp.call(to, [
                cpp.construct(
                  ANSWER,
                  [
                    request,
                    cpp.id("std::nullopt"),
                    cpp.lambda(
                      [],
                      [cpp.param(cpp.reference(cpp.type("facebook::jsi::Runtime")))],
                      [cpp.ret(cpp.call("facebook::jsi::Value::undefined"))],
                    ),
                  ],
                  true,
                ),
              ]),
            ),
          ];
    const failure = (to: cpp.Expr, message: cpp.Expr) =>
      cpp.exprStmt(cpp.call(to, [cpp.construct(ANSWER, [request, message], true)]));

    // A promise's answer: owed by the mount until it settles, and dropped if the mount ends first.
    const owed = cpp.id("owed");
    const later = cpp.id("later");
    const settled: cpp.Stmt[] = [
      lockState,
      cpp.ifStmt(cpp.not(state), [cpp.ret()]),
      cpp.varDecl(cpp.auto, "owed", cpp.call(cpp.dot(at("requests"), "find"), [request])),
      cpp.ifStmt(cpp.binary(owed, "==", cpp.call(cpp.dot(at("requests"), "end"))), [cpp.ret()]),
      cpp.varDecl(cpp.auto, "later", cpp.call("std::move", [cpp.arrow(owed, "second")])),
      cpp.exprStmt(cpp.call(cpp.dot(at("requests"), "erase"), [owed])),
      cpp.ifStmt(
        cpp.call(cpp.dot(cpp.id("promise"), "fulfilled")),
        nothing ? answer(later) : answer(later, cpp.call(cpp.dot(cpp.id("promise"), "value"))),
        [
          failure(
            later,
            cpp.call("lucent::views::errorMessage", [
              cpp.call(cpp.dot(cpp.id("promise"), "error")),
            ]),
          ),
        ],
      ),
    ];

    const settle: cpp.Stmt[] = promised
      ? [
          cpp.varDecl(cpp.auto, "promise", call),
          cpp.varDecl(cpp.type("std::weak_ptr", cpp.type("MountState")), "weak", state),
          // The continuation runs in a later microtask, once the answer is owed; a throw before keeps `respond`.
          cpp.exprStmt(
            cpp.call(cpp.dot(cpp.id("promise"), "onSettled"), [
              cpp.lambda(["promise", "request", "weak"], [], settled),
            ]),
          ),
          cpp.exprStmt(
            cpp.call(cpp.dot(at("requests"), "insert_or_assign"), [
              request,
              cpp.call("std::move", [respond]),
            ]),
          ),
        ]
      : nothing
        ? [cpp.exprStmt(call), ...answer(respond)]
        : [cpp.varDecl(cpp.auto, "result", call), ...answer(respond, cpp.id("result"))];

    return [
      cpp.varDecl(cpp.constType(cpp.type("double")), "request", cpp.arrow(c, "request_")),
      cpp.ifStmt(at("disposed"), [failure(respond, cpp.str("the view is gone")), cpp.ret()]),
      {
        k: "try",
        body: settle,
        catches: [
          { body: [failure(respond, cpp.call("lucent::views::thrownMessage", [current]))] },
        ],
      },
    ];
  }

  return cpp.fn(
    "command",
    cpp.voidType,
    [
      cpp.param(constRef(cpp.type("Command")), "command"),
      cpp.param(cpp.type("lucent::views::Respond"), "respond"),
    ],
    [
      cpp.varDecl(cpp.auto, "state", cpp.id("state_")),
      cpp.ifStmt(cpp.not(state), [cpp.ret()]),
      enterMain(),
      cpp.ifStmt(cpp.not(at("disposed")), [
        cpp.exprStmt(cpp.call(cpp.arrow(at("inbox"), "drain"))),
      ]),
      ...branches,
    ],
    { scope: cpp.type("Mount") },
  );
}

const constRef = (t: cpp.Type) => cpp.reference(cpp.constType(t));

const RESPOND = cpp.type("lucent::views::Respond");

/** Whether a mount may owe answers after a command returns: a request answering with a promise. */
const owesAnswers = (s: Setup): boolean =>
  s.commands.some(
    (command, i) =>
      s.component.commands[i]!.result.kind === "request" && command.type.ret.k === "promise",
  );

/**
 * Enters the main context for the rest of the block: a host calls from the
 * main thread, but outside any turn of Lucent's main context (throws on
 * another thread, or holding the Lucent lock).
 */
const enterMain = (): cpp.Stmt =>
  cpp.varDecl(
    cpp.type("lucent::ContextEntry"),
    "entry",
    cpp.call("lucent::ExecutionContext::main"),
    {
      style: "construct",
    },
  );

/** What a body's writer knows of its setup. */
export function bodySetup(setup: Setup): BodySetup {
  return {
    fn: setup.fn,
    ...(setup.propsSymbol ? { propsSymbol: setup.propsSymbol } : {}),
    export: setup.component.export,
    registration: setup.component.registration,
  };
}
