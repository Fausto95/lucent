/**
 * Component export analysis: which exports of `.lucent.tsx` modules are
 * components, and each one's description (contract.ts). A component is an
 * exported function whose code returns a platform view; React mounts it
 * through a host, so it is described instead of exported as a JavaScript
 * function. Its setup and the handlers it creates run on the main thread,
 * which the program analysis checks, with event prop calls known to post
 * their arguments to JavaScript rather than run code.
 *
 * One program is one target; merge.ts joins the targets' descriptions.
 */
import path from "node:path";
import ts from "typescript";
import { analyze, type Cause, type ProgramFacts, type Unit } from "../analysis/index.ts";
import { NO_NATIVE, type NativeFactsSource, SDK_NATIVE } from "../analysis/native.ts";
import { Codes, type Diagnostic } from "../diagnostics.ts";
import { platformScopes } from "../platforms.ts";
import {
  builtinSdkModuleOf,
  coreTypesPath,
  type LucentModule,
  type LucentProgram,
  platformOf,
} from "../program.ts";
import type { Platform } from "../sdk/schema.ts";
import { TOOLKITS, toolkitOfModule } from "./toolkits.ts";
import {
  artifactName,
  type CommandDescription,
  type ComponentDescription,
  componentId,
  registrationName,
} from "./contract.ts";
import {
  describeCommands,
  type DeliveryMark,
  describeProps,
  eventNames,
  type IsChildren,
  type Located,
  type Props,
} from "./describe.ts";
import { helperCalls, namedFunctions, setupExpose, skipParentheses, strayCalls } from "./expose.ts";
import { moduleIdentity } from "./identity.ts";
import {
  classIdentity,
  elementsOf,
  type FunctionLike,
  returnedExpressions,
  returnShape,
  type RootOf,
  SLOT_VIEWS,
  sdkRoot,
  sdkSlot,
} from "./roots.ts";
import { setupSlot } from "./slot.ts";
import { ViewTypes } from "./values.ts";

/** What the analysis needs to know about the program's SDKs and helpers. */
export interface ViewEnv {
  readonly native: NativeFactsSource;
  readonly root: RootOf;
  /** The class the platform's host makes a component's slot of (lucent:ui's `slot`). */
  readonly container: RootOf;
  /** Whether a declaration is lucent:ui's `expose`. */
  readonly expose: (decl: ts.Declaration) => boolean;
  /** Whether a declaration is lucent:ui's `slot`. */
  readonly slot: (decl: ts.Declaration) => boolean;
  /** Whether a declaration is lucent:ui's `Children`, the type of a `children` prop. */
  readonly children: (decl: ts.Declaration) => boolean;
  /** Whether a declaration is the brand of lucent:ui's delivery marks (`Continuous`, `Coalesced`). */
  readonly delivery: DeliveryMark;
}

export interface ViewAnalysis {
  readonly components: ComponentDescription[];
  /** The declarations of the exports that are components: not module functions. */
  readonly declarations: ReadonlySet<ts.Node>;
  /** Each component's setup: the function its id names. */
  readonly setups: ReadonlyMap<string, FunctionLike>;
  /** Module variables only main-thread code uses, which components may use (analysis/main-state.ts). */
  readonly mainState: ReadonlySet<ts.Symbol>;
  readonly diagnostics: Diagnostic[];
}

const UI_TYPES = path.resolve(path.dirname(coreTypesPath()), "ui.d.ts");

/** Whether `decl` is lucent:ui's declaration `name`. */
const uiDeclaration = (decl: ts.Declaration, name: string) =>
  path.resolve(decl.getSourceFile().fileName) === UI_TYPES &&
  (ts.isFunctionDeclaration(decl) || ts.isInterfaceDeclaration(decl)) &&
  decl.name?.text === name;

/** The discovered SDKs' root views, slot classes and native facts, and lucent:ui's helpers. */
export function sdkViews(lp: LucentProgram): ViewEnv {
  return {
    native: lp.platform ? SDK_NATIVE : NO_NATIVE,
    root: sdkRoot,
    container: sdkSlot,
    expose: (decl) => uiDeclaration(decl, "expose"),
    slot: (decl) => uiDeclaration(decl, "slot"),
    children: (decl) => uiDeclaration(decl, "Children"),
    delivery: (decl) =>
      path.resolve(decl.getSourceFile().fileName) === UI_TYPES &&
      ts.isPropertySignature(decl) &&
      ts.isComputedPropertyName(decl.name) &&
      ts.isIdentifier(decl.name.expression) &&
      decl.name.expression.text === "delivery",
  };
}

/** Whether a program has modules that may export components. */
export function hasComponentModules(lp: LucentProgram): boolean {
  return lp.modules.some((m) => isComponentFile(m.file));
}

/** An export whose code returns a view. */
interface Candidate {
  readonly module: LucentModule;
  readonly name: string;
  readonly fn: FunctionLike;
  /** The declaration statement: what the emitter leaves out. */
  readonly statement: ts.Statement;
  readonly root: ts.ClassDeclaration;
  readonly props?: ts.ParameterDeclaration;
}

export function analyzeViews(lp: LucentProgram, env: ViewEnv = sdkViews(lp)): ViewAnalysis {
  const checker = lp.checker;
  const diagnostics: Diagnostic[] = [];
  const declarations = new Set<ts.Node>();
  const candidates: Candidate[] = [];

  for (const m of lp.modules.filter((x) => isComponentFile(x.file)))
    for (const e of exportedFunctions(lp, m)) {
      const found = candidate(lp, env, m, e, diagnostics);

      if (found !== "value") declarations.add(e.statement);

      if (found && found !== "value") candidates.push(found);
    }

  const files = lp.modules.map((m) => m.sourceFile);
  const calls = {
    exposes: helperCalls(files, (callee) => isHelper(checker, env.expose, callee)),
    slots: helperCalls(files, (callee) => isHelper(checker, env.slot, callee)),
  };

  for (const p of [
    ...strayCalls("expose", calls.exposes, declarations),
    ...strayCalls("slot", calls.slots, declarations),
  ])
    diagnostics.push(at(p.node!, Codes.ComponentContract, p.message));

  if (!declarations.size)
    return {
      components: [],
      declarations,
      setups: new Map(),
      mainState: new Set(),
      diagnostics: inSourceOrder(diagnostics),
    };

  diagnostics.push(...references(lp, declarations));

  const facts = analyze({
    checker,
    modules: lp.modules,
    ...(lp.platform ? { platform: lp.platform } : {}),
    native: env.native,
    posts: postedCalls(checker, env, candidates),
    mainRoots: candidates.flatMap((c) => [
      c.fn,
      ...commandFunctions(checker, c, calls.exposes, lp.platform),
    ]),
  });
  const types = new ViewTypes(checker, (t, name) => facts.transfer(t, name));
  const components: ComponentDescription[] = [];
  const setups = new Map<string, FunctionLike>();

  for (const c of candidates) {
    const found = describeComponent(lp, env, facts, types, c, calls);

    diagnostics.push(...found.diagnostics);

    if (found.component) {
      components.push(found.component);
      setups.set(found.component.id, c.fn);
    }
  }

  return {
    components: diagnostics.length ? [] : components,
    declarations,
    setups: diagnostics.length ? new Map() : setups,
    mainState: facts.mainState().owned,
    diagnostics: inSourceOrder(diagnostics),
  };
}

/**
 * A component's commands, which run on the main thread: the functions its
 * `expose` names (`expose({ bump })`) and those it writes in place.
 */
function commandFunctions(
  checker: ts.TypeChecker,
  c: Candidate,
  exposes: readonly ts.CallExpression[],
  target: Platform | undefined,
): ts.Node[] {
  const { commands } = setupExpose(checker, c.name, c.fn, exposes, target);

  if (!commands) return [];

  const written = commands.properties.flatMap((p): ts.Node[] => {
    if (ts.isMethodDeclaration(p)) return [p];

    const value = ts.isPropertyAssignment(p) ? skipParentheses(p.initializer) : undefined;

    return value && (ts.isArrowFunction(value) || ts.isFunctionExpression(value)) ? [value] : [];
  });

  return [...namedFunctions(checker, commands), ...written];
}

/** Diagnostics by file and position; those at one place keep their order. */
function inSourceOrder(diagnostics: Diagnostic[]): Diagnostic[] {
  return diagnostics.toSorted(
    (a, b) => (a.file ?? "").localeCompare(b.file ?? "") || (a.start ?? 0) - (b.start ?? 0),
  );
}

/** Whether every value `fn` returns, in the code `platform` runs, is untyped (`any`): its SDKs are missing. */
function returnsOnlyUntyped(
  checker: ts.TypeChecker,
  fn: FunctionLike,
  platform: Platform | undefined,
): boolean {
  // A declaration (the host's stub of a split module): its declared return type.
  if (!fn.body) {
    const signature = checker.getSignatureFromDeclaration(fn);
    return !!(signature && checker.getReturnTypeOfSignature(signature).flags & ts.TypeFlags.Any);
  }
  const returned = returnedExpressions(checker, fn, platform);
  return (
    returned.length > 0 &&
    returned.every((r) => !!(checker.getTypeAtLocation(r).flags & ts.TypeFlags.Any))
  );
}

function isComponentFile(file: string): boolean {
  return file.endsWith(".tsx");
}

/** An exported function of a module, in the code the target compiles. */
interface Exported {
  readonly name: string;
  readonly fn: FunctionLike;
  readonly statement: ts.Statement;
}

function exportedFunctions(lp: LucentProgram, m: LucentModule): Exported[] {
  const scoped = platformOf(m.file)
    ? undefined
    : platformScopes(lp.checker, m.sourceFile).platforms;
  const out: Exported[] = [];

  for (const s of m.sourceFile.statements) {
    const platform = scoped?.get(s);

    if (!exported(s) || (platform && platform !== lp.platform)) continue;

    // Overload signatures are not the function; a host program's stubs declare without a body.
    if (ts.isFunctionDeclaration(s) && s.name && (s.body || m.stub))
      out.push({ name: s.name.text, fn: s, statement: s });

    if (ts.isVariableStatement(s))
      for (const d of s.declarationList.declarations) {
        const init = d.initializer && skipParentheses(d.initializer);

        if (
          ts.isIdentifier(d.name) &&
          init &&
          (ts.isArrowFunction(init) || ts.isFunctionExpression(init))
        )
          out.push({ name: d.name.text, fn: init, statement: s });
      }
  }

  return out;
}

/** An export's candidacy: a component, "value" (an ordinary export), or undefined after a diagnostic. */
function candidate(
  lp: LucentProgram,
  env: ViewEnv,
  m: LucentModule,
  e: Exported,
  diagnostics: Diagnostic[],
): Candidate | "value" | undefined {
  const checker = lp.checker;
  const shape = returnShape(checker, e.fn, lp.platform, env.root);
  const report = (message: string) => {
    diagnostics.push(at(e.fn, Codes.ComponentExport, message));
    return undefined;
  };

  if (shape.kind === "value") {
    // A one-file component whose body is some other platform's only.
    const elsewhere = lp.platform && otherBody(checker, e.fn, lp.platform);

    // As the merge of the targets' components reports it (ui/merge.ts).
    if (elsewhere) {
      diagnostics.push(
        at(
          e.fn,
          Codes.ComponentPlatforms,
          `\`${e.name}\` is a component on ${elsewhere} but not on ${lp.platform}: return a view on every platform`,
        ),
      );
      return undefined;
    }

    // Its views' SDKs aren't installed (a check on a machine without them): every value it
    // returns is untyped. It's left out like a component, which its platforms' builds check.
    if (returnsOnlyUntyped(checker, e.fn, lp.platform)) return undefined;

    return "value";
  }

  if (shape.kind === "promised")
    return report(
      `\`${e.name}\` returns a promise of a view: a component sets up its view synchronously, and can start asynchronous work after it returns`,
    );

  if (shape.kind === "ambiguous")
    return report(
      `\`${e.name}\` returns a view (\`${shape.view}\`) or another value (\`${shape.other}\`): a component returns its view on every path; split it into a component and a function`,
    );

  if (ts.isVariableStatement(e.statement) && e.statement.declarationList.declarations.length > 1)
    return report(
      `\`${e.name}\` is declared with other names in one statement: declare a component in its own \`export const\``,
    );

  if (e.fn.typeParameters?.length)
    return report(`\`${e.name}\` has type parameters: a component's props have one concrete type`);

  if (e.fn.parameters.length > 1)
    return report(
      `\`${e.name}\` has ${e.fn.parameters.length} parameters: a component takes one props object, or none`,
    );

  const props = e.fn.parameters[0];

  if (props && !ts.isIdentifier(props.name))
    return report(
      `\`${e.name}\` destructures its props: setup runs once, so read \`props.name\` where the value is used, and a destructured prop would keep its first value`,
    );

  if (props && !propsObject(checker, checker.getTypeAtLocation(props)))
    return report(
      `\`${e.name}\` takes \`${checker.typeToString(checker.getTypeAtLocation(props))}\`: a component's parameter is its props object, such as \`props: { title: string }\``,
    );

  return { module: m, ...e, root: shape.root, ...(props ? { props } : {}) };
}

/**
 * The platform whose toolkit's JSX a function returns, when the target is
 * not it (a one-file component's JSX is every toolkit's element type, and
 * the target's branch returns none).
 */
function otherBody(
  checker: ts.TypeChecker,
  fn: FunctionLike,
  target: Platform,
): Platform | undefined {
  const signature = checker.getSignatureFromDeclaration(fn);
  const returned = signature && checker.getReturnTypeOfSignature(signature);
  const types = returned?.isUnion() ? returned.types : returned ? [returned] : [];
  const platforms = types
    .flatMap((t) => elementsOf(t) ?? [])
    .flatMap((t) => {
      const decl = t.getSymbol()?.declarations?.[0];
      const toolkit = decl && toolkitOfModule(builtinSdkModuleOf(decl.getSourceFile()));

      return toolkit ? [TOOLKITS[toolkit].platform] : [];
    });

  return platforms.find((p) => p !== target);
}

/** A type that can be a props object: an object type that is not an array, tuple or function. */
function propsObject(checker: ts.TypeChecker, t: ts.Type): boolean {
  return (
    !!(t.flags & ts.TypeFlags.Object) &&
    !checker.isArrayType(t) &&
    !checker.isTupleType(t) &&
    !t.getCallSignatures().length
  );
}

/** Lucent code using a component: only its host may mount it. */
function references(lp: LucentProgram, declarations: ReadonlySet<ts.Node>): Diagnostic[] {
  const checker = lp.checker;
  const components = componentSymbols(lp, declarations);
  const out: Diagnostic[] = [];
  const visit = (n: ts.Node): void => {
    const use = ts.isIdentifier(n) && !declaresOrImports(n) && !inType(n);
    const symbol = use ? aliased(checker, n) : undefined;
    const name = symbol && components.get(symbol);

    if (name)
      out.push(
        at(
          n,
          Codes.ComponentExport,
          `\`${name}\` is a component: React mounts it through its host, so Lucent code cannot call it or use it as a value`,
        ),
      );

    ts.forEachChild(n, visit);
  };

  for (const m of lp.modules) visit(m.sourceFile);

  return out;
}

/** The symbols naming components: their declarations', and a platform module's shared declarations'. */
function componentSymbols(
  lp: LucentProgram,
  declarations: ReadonlySet<ts.Node>,
): Map<ts.Symbol, string> {
  const checker = lp.checker;
  const out = new Map<ts.Symbol, string>();
  const add = (name: ts.Identifier) => {
    const symbol = checker.getSymbolAtLocation(name);

    if (symbol) out.set(symbol, name.text);
  };

  for (const m of lp.modules) {
    const names = m.sourceFile.statements.filter((s) => declarations.has(s)).flatMap(declaredNames);

    names.forEach(add);

    for (const s of m.declaration?.statements ?? [])
      for (const name of declaredNames(s)) if (names.some((n) => n.text === name.text)) add(name);
  }

  return out;
}

function declaredNames(s: ts.Node): ts.Identifier[] {
  if (ts.isFunctionDeclaration(s) && s.name) return [s.name];

  if (ts.isVariableStatement(s))
    return s.declarationList.declarations.flatMap((d) => (ts.isIdentifier(d.name) ? [d.name] : []));

  return [];
}

/** Whether a node is part of a type (`typeof Title`), where naming a component calls nothing. */
function inType(n: ts.Node): boolean {
  for (let p = n.parent; p && !ts.isStatement(p); p = p.parent) if (ts.isTypeNode(p)) return true;

  return false;
}

/** What an identifier names, through imports. */
function aliased(checker: ts.TypeChecker, n: ts.Identifier): ts.Symbol | undefined {
  const found = checker.getSymbolAtLocation(n);

  return found && found.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(found) : found;
}

/** The name a declaration, import or export declares: not a use. */
function declaresOrImports(n: ts.Identifier): boolean {
  const p = n.parent;

  return (
    ((ts.isFunctionDeclaration(p) || ts.isVariableDeclaration(p)) && p.name === n) ||
    ts.isImportSpecifier(p) ||
    ts.isImportClause(p) ||
    ts.isExportSpecifier(p)
  );
}

/**
 * Event prop calls on components' props parameters, and calls of expose
 * and slot: they run no code here.
 */
function postedCalls(
  checker: ts.TypeChecker,
  env: ViewEnv,
  candidates: readonly Candidate[],
): (call: ts.CallExpression) => boolean {
  const events = new Map<ts.Symbol, Set<string>>();

  for (const c of candidates) {
    const symbol =
      c.props && ts.isIdentifier(c.props.name) && checker.getSymbolAtLocation(c.props.name);

    if (symbol) events.set(symbol, eventNames(checker, checker.getTypeAtLocation(c.props!)));
  }

  return (call) => {
    const callee = skipParentheses(call.expression);

    if (ts.isIdentifier(callee))
      return isHelper(checker, env.expose, callee) || isHelper(checker, env.slot, callee);

    if (!ts.isPropertyAccessExpression(callee) || !ts.isIdentifier(callee.expression)) return false;

    const receiver = checker.getSymbolAtLocation(callee.expression);

    return !!receiver && !!events.get(receiver)?.has(callee.name.text);
  };
}

/** Whether `callee` names the lucent:ui helper `helper` recognizes. */
function isHelper(
  checker: ts.TypeChecker,
  helper: (decl: ts.Declaration) => boolean,
  callee: ts.Expression,
): boolean {
  const e = skipParentheses(callee);

  return ts.isIdentifier(e) && !!aliased(checker, e)?.declarations?.some(helper);
}

/** Whether a type is lucent:ui's `Children`. */
const childrenType =
  (env: ViewEnv): IsChildren =>
  (t) =>
    !!t.getSymbol()?.declarations?.some(env.children);

/** A candidate's description, or the diagnostics that keep it from being one. */
function describeComponent(
  lp: LucentProgram,
  env: ViewEnv,
  facts: ProgramFacts,
  types: ViewTypes,
  c: Candidate,
  calls: {
    readonly exposes: readonly ts.CallExpression[];
    readonly slots: readonly ts.CallExpression[];
  },
): { component?: ComponentDescription; diagnostics: Diagnostic[] } {
  const checker = lp.checker;
  const diagnostics: Diagnostic[] = [];
  const report = (p: Located) =>
    diagnostics.push(at(p.node ?? c.fn, Codes.ComponentContract, p.message));
  const identity = moduleIdentity(c.module.declaration?.fileName ?? c.module.file);

  if (!identity)
    diagnostics.push(
      at(
        c.fn,
        Codes.ComponentExport,
        `\`${c.name}\` needs a package to be identified by: add a package.json with a \`name\` next to its module or above it`,
      ),
    );

  const props = describeProps(
    checker,
    types,
    env.delivery,
    c.name,
    c.props && checker.getTypeAtLocation(c.props),
    childrenType(env),
  );

  props.problems.forEach(report);

  if (!props.problems.length)
    diagnostics.push(...declarationMismatch(checker, types, env, c, props));

  slotProblems(lp, env, c, props, calls.slots).forEach(report);

  const exposed = setupExpose(checker, c.name, c.fn, calls.exposes, lp.platform);

  exposed.problems.forEach(report);

  const commands = exposed.commands
    ? exposedCommands(checker, types, c, exposed.commands, report)
    : [];
  const named = exposed.commands ? namedFunctions(checker, exposed.commands) : [];

  diagnostics.push(...mainThread(facts, c, named));

  if (diagnostics.length || !identity) return { diagnostics };

  const id = componentId(identity.package, identity.module, c.name);
  const registration = registrationName(id);
  const node = ts.isFunctionDeclaration(c.fn) ? c.fn : c.statement;
  const source = node.getSourceFile().getLineAndCharacterOfPosition(node.getStart());

  return {
    diagnostics,
    component: {
      id,
      package: identity.package,
      module: identity.module,
      export: c.name,
      jsModule: c.module.name,
      registration,
      props: props.props,
      events: props.events,
      commands,
      ...(props.children ? { children: props.children } : {}),
      platforms: lp.platform
        ? {
            [lp.platform]: {
              root: classIdentity(checker, c.root),
              artifact: artifactName(lp.platform, registration),
            },
          }
        : {},
      source: { file: c.module.file, line: source.line + 1, column: source.character + 1 },
    },
  };
}

/**
 * Why component `c`'s slot is not where its children can go: children
 * without a slot, a slot without children, a slot made elsewhere than at
 * the top of setup, or of another class than the platform's container.
 */
function slotProblems(
  lp: LucentProgram,
  env: ViewEnv,
  c: Candidate,
  props: Props,
  calls: readonly ts.CallExpression[],
): Located[] {
  const checker = lp.checker;
  const container = SLOT_VIEWS[lp.platform ?? "ios"].name;
  const example = `slot<${container}>()`;
  const slot = setupSlot(c.name, c.fn, calls, example, checker, lp.platform);
  const out = [...slot.problems];

  // A host program's stub declares a component without code.
  if (!c.fn.body || out.length) return out;

  if (props.children && !slot.call)
    out.push({
      message: `\`${c.name}\` takes children, but its setup makes no slot for them: \`const content = ${example}\` (the platform's container), put in the view it returns`,
      node: c.fn,
    });

  if (slot.call && !props.children)
    out.push({
      message: `\`${c.name}\` makes a slot, but its props take no children: declare \`children?: Children\` (lucent:ui)`,
      node: slot.call,
    });

  const made = slot.call && checker.getTypeAtLocation(slot.call);
  const cls = made?.getSymbol()?.declarations?.[0];

  if (
    made &&
    lp.platform &&
    !(cls && ts.isClassDeclaration(cls) && env.container(cls) === lp.platform)
  )
    out.push({
      message: `\`${c.name}\`'s slot is a \`${checker.typeToString(made)}\`: a slot is the platform's container, \`${example}\``,
      node: slot.call!,
    });

  return out;
}

/** A platform module's component whose props, events or children differ from those its shared file declares. */
function declarationMismatch(
  checker: ts.TypeChecker,
  types: ViewTypes,
  env: ViewEnv,
  c: Candidate,
  own: Props,
): Diagnostic[] {
  const file = c.module.declaration;
  const declared = file?.statements.find(
    (s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === c.name,
  );

  if (!file || !declared) return [];

  const param = declared.parameters[0];
  const theirs = describeProps(
    checker,
    types,
    env.delivery,
    c.name,
    param && checker.getTypeAtLocation(param),
    childrenType(env),
  );
  const differs = (["props", "events", "children"] as const).filter(
    (k) => JSON.stringify(theirs[k]) !== JSON.stringify(own[k]),
  );

  return differs.map((k) =>
    at(
      c.props ?? c.fn,
      Codes.ComponentPlatforms,
      `\`${c.name}\`'s ${k} in ${path.basename(c.module.file)} differ from those ${path.basename(file.fileName)} declares: a component's props, events and commands are the same on every platform`,
    ),
  );
}

/** The commands of the object the component's setup exposes. */
function exposedCommands(
  checker: ts.TypeChecker,
  types: ViewTypes,
  c: Candidate,
  exposed: ts.ObjectLiteralExpression,
  report: (p: Located) => void,
): CommandDescription[] {
  const problems: Located[] = [];
  const type = checker.getTypeAtLocation(exposed);
  const commands = describeCommands(checker, types, c.name, type, problems);

  problems.forEach(report);

  return commands;
}

/**
 * Why the component's setup, a function it creates or a function its
 * commands name (`named`) cannot run on the main thread. One cause is
 * reported once per rule, however many of them reach it.
 */
function mainThread(facts: ProgramFacts, c: Candidate, named: readonly ts.Node[]): Diagnostic[] {
  const setup = facts.unit(c.fn);

  // A host program's stub declares a component without code.
  if (!setup && !c.fn.body) return [];

  if (!setup) throw new Error(`the component ${c.name} is not a unit of the program's analysis`);

  const roots = [setup, ...named.flatMap((n) => facts.unit(n) ?? [])];
  const units = facts.units.filter((u) => roots.some((r) => u === r || within(u, r)));
  const seen = new Set<string>();
  const out: Diagnostic[] = [];

  for (const u of units)
    for (const v of facts.check(u, "main")) {
      const last = lastCause(v.cause);
      const key = `${v.rule} ${last.node.getSourceFile().fileName} ${last.node.getStart()}`;

      if (seen.has(key)) continue;

      seen.add(key);
      out.push({ ...at(v.cause.node, Codes.ComponentMainThread, v.message), fix: v.fix });
    }

  return out;
}

/** The last step of a cause path: what breaks the rule. */
function lastCause(cause: Cause): Cause {
  let out = cause;

  while (out.next) out = out.next;

  return out;
}

/** Whether `unit` is created, directly or not, by `parent`'s code. */
function within(unit: Unit, parent: Unit): boolean {
  for (let u = unit.parent; u; u = u.parent) if (u === parent) return true;

  return false;
}

function exported(s: ts.Statement): boolean {
  return (
    ts.canHaveModifiers(s) &&
    !!ts.getModifiers(s)?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
  );
}

function at(node: ts.Node, code: string, message: string): Diagnostic {
  const sf = node.getSourceFile();
  const start = node.getStart(sf);
  const { line, character } = sf.getLineAndCharacterOfPosition(start);

  return {
    code,
    message,
    file: sf.fileName,
    line: line + 1,
    column: character + 1,
    start,
    length: node.getEnd() - start,
  };
}
