/**
 * The members of instances a view uses, and the uses that race with them
 * (decision 0075). A view's code runs on the main thread without its
 * module's lock: its setup, the functions it makes (effects, handlers,
 * commands) and what they call, but not `main()` callbacks, which hold
 * the lock. Code off the main thread (module code, JavaScript reading or
 * writing a public field, tasks and executors) may run at the same time.
 *
 * A member both sides use, one of them writing it, races. A member only
 * the main thread uses is the main thread's, and one nothing writes once
 * its instance is made may be read anywhere. A class's construction runs
 * before its instance reaches a view, so it is no use. A use of a member
 * holding an array or a plain object may change what it holds, so it
 * counts as a write; one holding an instance is a use of the instance's
 * own members, which are checked in turn.
 *
 * The instances checked are those a view's props reach: of their classes,
 * the classes those extend or that extend them, and the classes their
 * members hold, in turn.
 */
import ts from "typescript";
import type { OwnerId } from "../ir/ir.ts";
import { isLibFile } from "../program.ts";
import { type Cause, code, step } from "./facts.ts";
import type { Solved } from "./solve.ts";
import type { ProgramUnits, Unit } from "./units.ts";

/** A race between a view's use of a member and another use off the main thread. */
export interface MemberRace {
  /** `Player.title`. */
  readonly member: string;
  /** The view's use: the path from its root to it, the last step using the member. */
  readonly view: Cause;
  /** The other use: "`Player.rename` (m.lucent.ts:9:5) writes it". */
  readonly other: string;
}

/** A member a class declares: a field, or a parameter property. */
type Member = ts.PropertyDeclaration | ts.ParameterDeclaration;

interface Use {
  readonly unit: Unit;
  readonly node: ts.Node;
  readonly write: boolean;
}

/** One step from the unit that runs a view unit to it. */
interface Via {
  readonly from: Unit;
  readonly node: ts.Node;
  readonly text: string;
}

export function viewMemberRaces(
  solved: Solved,
  owners: (u: Unit) => ReadonlyMap<OwnerId, Cause>,
  roots: readonly Unit[],
  seeds: ReadonlySet<ts.ClassLikeDeclaration>,
): MemberRace[] {
  const checker = solved.p.checker;
  const units = solved.p.units;
  const classes = reachableClasses(checker, units, seeds);

  if (!classes.size) return [];

  const view = viewUnits(solved, owners, roots);
  const uses = memberUses(checker, units, classes);
  const out: MemberRace[] = [];

  for (const [member, all] of uses) {
    const mine = all.filter((u) => view.has(u.unit));

    if (!mine.length) continue;

    const deep = holdsData(checker, member);
    const writes = (u: Use) => u.write || deep;
    const others: { write: boolean; text: string }[] = [
      ...all
        .filter((u) => u.unit.kind !== "constructor" && offMain(owners(u.unit)))
        .map((u) => ({
          write: writes(u),
          text: `${code(u.unit.display)} (${where(u.node)}) ${writes(u) ? "writes" : "reads"} it`,
        })),
      ...javaScriptUses(member),
    ];

    const viewUse = mine.find(writes);
    const other = viewUse ? others[0] : others.find((o) => o.write);
    const used = viewUse ?? mine[0]!;

    if (!other) continue;

    out.push({
      member: memberName(member),
      view: pathTo(view, used, `${writes(used) ? "writes" : "reads"} ${code(memberName(member))}`),
      other: other.text,
    });
  }

  return out;
}

/** Whether any of a unit's runners is off the main thread. */
function offMain(owners: ReadonlyMap<OwnerId, Cause>): boolean {
  return [...owners.keys()].some((o) => o !== "main");
}

/**
 * A view's units, each with the step that runs it from the one before:
 * the roots, the functions their code makes (but `main()` callbacks and
 * what runs off the main thread), and what they call (but through
 * `main()`).
 */
function viewUnits(
  solved: Solved,
  owners: (u: Unit) => ReadonlyMap<OwnerId, Cause>,
  roots: readonly Unit[],
): Map<Unit, Via | undefined> {
  const locked = new Set<Unit>();

  for (const edges of solved.edges.values())
    for (const e of edges) if (e.mode === "main") for (const t of e.targets) locked.add(t);

  const children = new Map<Unit, Unit[]>();

  for (const u of solved.p.units.list)
    if (u.parent) children.set(u.parent, [...(children.get(u.parent) ?? []), u]);

  const out = new Map<Unit, Via | undefined>(roots.map((r) => [r, undefined]));
  const queue = [...roots];

  const add = (u: Unit, via: Via) => {
    if (out.has(u) || locked.has(u)) return;

    out.set(u, via);
    queue.push(u);
  };

  while (queue.length) {
    const u = queue.shift()!;

    for (const e of solved.edges.get(u) ?? [])
      if (e.mode !== "main")
        for (const t of e.targets) add(t, { from: u, node: e.node, text: e.text });

    for (const c of children.get(u) ?? [])
      if (owners(c).has("main"))
        add(c, { from: u, node: c.node, text: `makes ${code(c.display)}` });
  }

  return out;
}

/** The path from a view's root to `use`, ending with `text`. */
function pathTo(view: ReadonlyMap<Unit, Via | undefined>, use: Use, text: string): Cause {
  let cause = step(use.unit, use.node, text);

  for (let u = use.unit, via = view.get(u); via; u = via.from, via = view.get(u))
    cause = step(via.from, via.node, via.text, cause);

  return cause;
}

/** The classes whose instances `seeds`' instances reach. */
function reachableClasses(
  checker: ts.TypeChecker,
  units: ProgramUnits,
  seeds: ReadonlySet<ts.ClassLikeDeclaration>,
): Set<ts.ClassLikeDeclaration> {
  const out = new Set<ts.ClassLikeDeclaration>();
  const queue = [...seeds];

  const add = (c: ts.ClassLikeDeclaration | undefined) => {
    if (c && units.classes.has(c) && !out.has(c)) {
      out.add(c);
      queue.push(c);
    }
  };

  while (queue.length) {
    const c = queue.shift()!;

    out.add(c);
    add(units.classes.get(c)?.base);

    for (const other of units.classes.values()) if (other.base === c) add(other.declaration);

    for (const m of c.members) {
      const types =
        ts.isPropertyDeclaration(m) || ts.isGetAccessorDeclaration(m)
          ? [checker.getTypeAtLocation(m)]
          : ts.isMethodDeclaration(m)
            ? checker
                .getSignaturesOfType(checker.getTypeAtLocation(m), ts.SignatureKind.Call)
                .map((s) => checker.getReturnTypeOfSignature(s))
            : ts.isConstructorDeclaration(m)
              ? m.parameters.filter(isParameterProperty).map((p) => checker.getTypeAtLocation(p))
              : [];

      for (const t of types) for (const held of classesIn(checker, t)) add(held);
    }
  }

  return out;
}

/** The class declarations a type names: itself, its union's members, its elements, a promise's value. */
function classesIn(
  checker: ts.TypeChecker,
  t: ts.Type,
  seen = new Set<ts.Type>(),
): ts.ClassLikeDeclaration[] {
  if (seen.has(t)) return [];

  seen.add(t);

  if (t.isUnion() || t.isIntersection()) return t.types.flatMap((m) => classesIn(checker, m, seen));

  const decl = t.getSymbol()?.declarations?.find(ts.isClassLike);
  const args =
    t.flags & ts.TypeFlags.Object && (t as ts.ObjectType).objectFlags & ts.ObjectFlags.Reference
      ? checker.getTypeArguments(t as ts.TypeReference)
      : [];

  return [...(decl ? [decl] : []), ...args.flatMap((a) => classesIn(checker, a, seen))];
}

/** Every use of a member of `classes` in the program's code, by the member's declaration. */
function memberUses(
  checker: ts.TypeChecker,
  units: ProgramUnits,
  classes: ReadonlySet<ts.ClassLikeDeclaration>,
): Map<Member, Use[]> {
  const out = new Map<Member, Use[]>();

  for (const u of units.list) {
    const visit = (n: ts.Node): void => {
      if (n !== u.node && units.byNode.get(n) && units.byNode.get(n) !== u) return;

      const symbol = ts.isPropertyAccessExpression(n)
        ? checker.getSymbolAtLocation(n.name)
        : ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression)
          ? checker.getSymbolAtLocation(n.argumentExpression)
          : destructured(checker, n);

      if (symbol)
        for (const member of membersOf(units, classes, symbol)) {
          const list = out.get(member);
          const use = {
            unit: u,
            node: n,
            write: !ts.isBindingElement(n) && written(n as ts.Expression),
          };

          if (list) list.push(use);
          else out.set(member, [use]);
        }

      ts.forEachChild(n, visit);
    };

    for (const c of u.code) visit(c);
  }

  return out;
}

/** The property a binding element of an object pattern reads (`const { title } = player`). */
function destructured(checker: ts.TypeChecker, n: ts.Node): ts.Symbol | undefined {
  if (!ts.isBindingElement(n) || !ts.isObjectBindingPattern(n.parent) || n.dotDotDotToken)
    return undefined;

  const key = n.propertyName ?? n.name;

  if (!ts.isIdentifier(key) && !ts.isStringLiteralLike(key)) return undefined;

  return checker.getTypeAtLocation(n.parent).getProperty(key.text);
}

/**
 * The members of `classes` a property is: the field it is, or for an
 * interface's property, the field of that name of each class implementing
 * it.
 */
function membersOf(
  units: ProgramUnits,
  classes: ReadonlySet<ts.ClassLikeDeclaration>,
  symbol: ts.Symbol,
): Member[] {
  const decl = symbol.valueDeclaration ?? symbol.declarations?.[0];

  if (!decl) return [];

  if (isMember(decl)) return classes.has(classOf(decl)!) ? [decl] : [];

  if (!ts.isPropertySignature(decl) || !ts.isInterfaceDeclaration(decl.parent)) return [];

  const iface = decl.parent;
  const key = symbol.getName();
  const out: Member[] = [];

  for (const c of classes) {
    if (!implementsOf(units, c).includes(iface)) continue;

    for (let at: ts.ClassLikeDeclaration | undefined = c; at; at = units.classes.get(at)?.base) {
      const found = fieldsOf(at).find((m) => m.name.getText() === key);

      if (found) {
        out.push(found);
        break;
      }
    }
  }

  return out;
}

/** The interfaces a class implements, its bases' too. */
function implementsOf(units: ProgramUnits, c: ts.ClassLikeDeclaration): ts.InterfaceDeclaration[] {
  const out: ts.InterfaceDeclaration[] = [];

  for (let at: ts.ClassLikeDeclaration | undefined = c; at; at = units.classes.get(at)?.base)
    out.push(...(units.classes.get(at)?.implements ?? []));

  return out;
}

/** A class's instance fields and parameter properties. */
function fieldsOf(c: ts.ClassLikeDeclaration): Member[] {
  const ctor = c.members.find(ts.isConstructorDeclaration);

  return [
    ...c.members.filter(
      (m): m is ts.PropertyDeclaration => ts.isPropertyDeclaration(m) && !isStatic(m),
    ),
    ...(ctor?.parameters.filter(isParameterProperty) ?? []),
  ];
}

function isMember(decl: ts.Declaration): decl is Member {
  return (
    (ts.isPropertyDeclaration(decl) && !isStatic(decl)) ||
    (ts.isParameter(decl) && isParameterProperty(decl))
  );
}

function classOf(m: Member): ts.ClassLikeDeclaration | undefined {
  const owner = ts.isParameter(m) ? m.parent.parent : m.parent;

  return ts.isClassLike(owner) ? owner : undefined;
}

function isParameterProperty(p: ts.ParameterDeclaration): boolean {
  return ts.isConstructorDeclaration(p.parent) && ts.getModifiers(p)?.length
    ? ts
        .getModifiers(p)!
        .some((m) =>
          [
            ts.SyntaxKind.PublicKeyword,
            ts.SyntaxKind.PrivateKeyword,
            ts.SyntaxKind.ProtectedKeyword,
            ts.SyntaxKind.ReadonlyKeyword,
          ].includes(m.kind),
        )
    : false;
}

function isStatic(m: ts.ClassElement): boolean {
  return (
    ts.canHaveModifiers(m) &&
    !!ts.getModifiers(m)?.some((x) => x.kind === ts.SyntaxKind.StaticKeyword)
  );
}

function hasModifier(m: Member, kind: ts.SyntaxKind): boolean {
  return !!ts.getModifiers(m)?.some((x) => x.kind === kind);
}

/** `Player.title`. */
function memberName(m: Member): string {
  return `${classOf(m)?.name?.text ?? "class"}.${m.name.getText()}`;
}

/** What JavaScript does with a public field of an exported class: reads it, and writes it unless it is readonly. */
function javaScriptUses(m: Member): { write: boolean; text: string }[] {
  const c = classOf(m);
  const exported =
    !!c &&
    ts.canHaveModifiers(c) &&
    !!ts.getModifiers(c)?.some((x) => x.kind === ts.SyntaxKind.ExportKeyword);
  const hidden =
    hasModifier(m, ts.SyntaxKind.PrivateKeyword) ||
    hasModifier(m, ts.SyntaxKind.ProtectedKeyword) ||
    ts.isPrivateIdentifier(m.name);

  if (!exported || hidden) return [];

  return hasModifier(m, ts.SyntaxKind.ReadonlyKeyword)
    ? [{ write: false, text: "JavaScript reads it, a public field" }]
    : [{ write: true, text: "JavaScript may write it, a public field that is not `readonly`" }];
}

/**
 * Whether a member holds data its uses may change in place: an array, a
 * collection, a library object (a `Date`, a typed array) or a plain
 * object; not a primitive, a function, a native object or a class
 * instance (whose own members are checked).
 */
function holdsData(checker: ts.TypeChecker, m: Member): boolean {
  const t = checker.getNonNullableType(checker.getTypeAtLocation(m));

  return (t.isUnion() ? t.types : [t]).some((x) => {
    if (!(x.flags & ts.TypeFlags.Object) || x.getCallSignatures().length) return false;

    const decl = x.getSymbol()?.declarations?.[0];

    if (!decl) return true;

    if (ts.isClassLike(decl) && !isLibFile(decl.getSourceFile())) return false;

    // A library type is data; another declaration file's (an SDK's) is a native object.
    return !decl.getSourceFile().isDeclarationFile || isLibFile(decl.getSourceFile());
  });
}

/** Whether a property access is written: assigned, incremented or deleted. */
function written(e: ts.Expression): boolean {
  let n: ts.Node = e;

  while (ts.isParenthesizedExpression(n.parent) || ts.isNonNullExpression(n.parent)) n = n.parent;

  const p = n.parent;

  if (ts.isBinaryExpression(p))
    return (
      p.left === n &&
      p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      p.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    );

  if (ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p))
    return (
      p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken
    );

  return ts.isDeleteExpression(p);
}

function where(node: ts.Node): string {
  const sf = node.getSourceFile();
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
  const file = sf.fileName.slice(sf.fileName.lastIndexOf("/") + 1);

  return `${file}:${line + 1}:${character + 1}`;
}
