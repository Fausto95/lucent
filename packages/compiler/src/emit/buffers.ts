/**
 * lucent:core's NativeBuffer and the spans its borrows lend
 * (lucent/buffer.h). A buffer is a handle (lucent::NativeBuffer); its
 * `withRead`/`withWrite` lower to the runtime's borrows, which lend the
 * callback a ByteSpan or MutableByteSpan over the storage itself.
 *
 * The runtime refuses conflicting borrows and use after a move; what it
 * cannot see is a span kept past its callback, which would read storage a
 * task may be writing or has released. So the compiler keeps each span in
 * its callback: the callback is a literal or a named function (whose code
 * it can follow), not async, and its span parameter does not escape by
 * any path the program analysis finds (returned, stored, captured by an
 * escaping closure, kept by a callee, used after await). It also reports
 * a buffer used after it certainly moved (transfer(), a compute handoff);
 * aliases it cannot follow are the runtime's to refuse.
 */
import { cpp } from "@lucent-lang/codegen";
import path from "node:path";
import ts from "typescript";
import { Codes, fail } from "../diagnostics.ts";
import { cppIdent, isVoidish, type LType, T, unionOf } from "../types.ts";
import { DISPOSE } from "./classes.ts";
import { factsOf } from "./compute.ts";
import type { E } from "./context.ts";
import { isCoreSymbol } from "./core.ts";
import type { FnEmitter } from "./function.ts";

type Lowers = (em: FnEmitter, node: ts.CallExpression, receiver: E) => E;

const num = (c: cpp.Expr): E => ({ c, t: T.number });
const done = (c: cpp.Expr): E => ({ c, t: T.undefined });

function arg(em: FnEmitter, node: ts.CallExpression, i: number, t: LType): cpp.Expr {
  const a = node.arguments[i];

  if (!a) fail(node, Codes.UnsupportedCall, `missing argument ${i + 1}`);

  return em.exprAs(a, t);
}

/** The arguments from `i` on that the call gives. */
function given(em: FnEmitter, node: ts.CallExpression, from: number, t: LType): cpp.Expr[] {
  return node.arguments.slice(from).map((a) => em.exprAs(a, t));
}

// --- NativeBuffer.allocate / from / stats ---------------------------------------

const STATICS: Record<string, (em: FnEmitter, node: ts.CallExpression) => E> = {
  allocate: (em, node) => ({
    c: cpp.call("lucent::NativeBufferObject::allocate", [arg(em, node, 0, T.number)]),
    t: T.buffer,
  }),

  from: (em, node) => ({
    c: cpp.call("lucent::NativeBufferObject::fromBytes", [arg(em, node, 0, T.bytes)]),
    t: T.buffer,
  }),

  stats: (em, node) => {
    const t = em.lt(node);

    if (t.k !== "struct") throw new Error("NativeBuffer.stats() is not a struct");

    const info = em.reg.struct(t.id);
    const countsName = em.ctx.fresh("counts");
    const counts = cpp.id(countsName);
    const stats = em.ctx.fresh("stats");
    const created = cpp.call("std::make_shared", [], [cpp.type(`lucent_app::${info.cppName}`)]);
    const fields = info.fields.map((f) =>
      cpp.exprStmt(
        cpp.assign(
          cpp.arrow(cpp.id(stats), cppIdent(f.name)),
          cpp.staticCast(cpp.type("double"), cpp.dot(counts, f.name)),
        ),
      ),
    );

    return {
      c: cpp.statementExpr(
        [
          cpp.varDecl(cpp.auto, countsName, cpp.call("lucent::NativeBufferObject::stats")),
          cpp.varDecl(cpp.auto, stats, created),
          ...fields,
        ],
        cpp.id(stats),
      ),
      t,
    };
  },
};

/** Whether `e` names lucent:core's NativeBuffer class. */
function isBufferClass(em: FnEmitter, e: ts.Expression): boolean {
  const found = ts.isIdentifier(e) ? em.checker.getSymbolAtLocation(e) : undefined;
  const sym =
    found && found.flags & ts.SymbolFlags.Alias ? em.checker.getAliasedSymbol(found) : found;

  return !!sym && sym.name === "NativeBuffer" && isCoreSymbol(sym);
}

/** `NativeBuffer.allocate(n)` and the other statics; undefined for other calls. */
export function bufferStatic(
  em: FnEmitter,
  node: ts.CallExpression,
  callee: ts.PropertyAccessExpression,
): E | undefined {
  if (!isBufferClass(em, callee.expression)) return undefined;

  const name = callee.name.text;
  const lower = Object.hasOwn(STATICS, name) ? STATICS[name] : undefined;

  if (!lower) fail(node, Codes.UnsupportedBuiltin, `NativeBuffer.${name} is not supported`);

  return lower(em, node);
}

// --- a buffer's members ----------------------------------------------------------

const close: Lowers = (_em, _node, buffer) =>
  done(cpp.cast("c", cpp.voidType, cpp.call(cpp.arrow(buffer.c, "close"))));

const METHODS: Record<string, Lowers> = {
  withRead: (em, node, buffer) => borrow(em, node, buffer, "withRead", T.span),
  withWrite: (em, node, buffer) => borrow(em, node, buffer, "withWrite", T.mutableSpan),
  toUint8Array: (_em, _node, buffer) => ({
    c: cpp.call(cpp.arrow(buffer.c, "toBytes")),
    t: T.bytes,
  }),
  transfer: (em, node, buffer) => {
    const receiver = (node.expression as ts.PropertyAccessExpression).expression;

    refuseLaterUse(em, receiver, node, "transfer() moved its bytes to another buffer");
    return { c: cpp.call(cpp.arrow(buffer.c, "transfer")), t: T.buffer };
  },
  close,
};

export function bufferMethod(em: FnEmitter, buffer: E, name: string, node: ts.CallExpression): E {
  // `[Symbol.dispose]()`, which `using` runs, closes it too.
  const lower = name === DISPOSE ? close : Object.hasOwn(METHODS, name) ? METHODS[name] : undefined;

  if (!lower)
    fail(node, Codes.UnsupportedBuiltin, `NativeBuffer.prototype.${name} is not supported`);

  return lower(em, node, buffer);
}

export function bufferProperty(buffer: E, name: string, node: ts.Node): E {
  if (name !== "byteLength")
    fail(node, Codes.UnsupportedBuiltin, `NativeBuffer.prototype.${name} is not supported`);

  return num(cpp.staticCast(cpp.type("double"), cpp.call(cpp.arrow(buffer.c, "size"))));
}

/** What `using` runs for a buffer: close(). */
export function bufferDispose(buffer: E): cpp.Expr {
  return cpp.call(cpp.arrow(buffer.c, "close"));
}

// --- spans -----------------------------------------------------------------------

const SPAN_METHODS: Record<string, Lowers> = {
  fill: (em, node, span) => done(cpp.call(cpp.dot(span.c, "fill"), given(em, node, 0, T.number))),
  set: (em, node, span) =>
    done(
      cpp.call(cpp.dot(span.c, "setFrom"), [
        arg(em, node, 0, T.bytes),
        ...given(em, node, 1, T.number),
      ]),
    ),
};

export function spanMethod(em: FnEmitter, span: E, name: string, node: ts.CallExpression): E {
  const lower =
    span.t.k === "span" && span.t.writable && Object.hasOwn(SPAN_METHODS, name)
      ? SPAN_METHODS[name]
      : undefined;

  if (!lower) fail(node, Codes.UnsupportedBuiltin, `${name}() is not supported on a byte span`);

  return lower(em, node, span);
}

export function spanProperty(span: E, name: string, node: ts.Node): E {
  if (name !== "length")
    fail(node, Codes.UnsupportedBuiltin, `.${name} is not supported on a byte span`);

  return num(cpp.call(cpp.dot(span.c, "length")));
}

/** `span[i]`: undefined out of range. */
export function spanElement(span: E, index: cpp.Expr): E {
  return { c: cpp.call(cpp.dot(span.c, "get"), [index]), t: unionOf([T.number, T.undefined]) };
}

// --- borrows ---------------------------------------------------------------------

type Callback = ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration;

/** `buffer.withRead(f)`: the runtime's borrow, lending `f` its span. */
function borrow(
  em: FnEmitter,
  node: ts.CallExpression,
  buffer: E,
  method: "withRead" | "withWrite",
  span: LType,
): E {
  const [given, ...others] = node.arguments;

  if (!given || others.length)
    fail(node, Codes.UnsupportedCall, `${method} takes one callback, which it lends the bytes`);

  checkBorrow(em, callbackOf(em, given, method), method);

  const result = em.lt(node);
  const target: LType = { k: "fn", params: [span], ret: result };
  const f =
    ts.isArrowFunction(given) || ts.isFunctionExpression(given)
      ? em.closure(given, target)
      : em.expr(given);

  return {
    c: cpp.call(`lucent::${method}`, [buffer.c, em.coerce(f, target, given)]),
    t: isVoidish(result) ? T.undefined : result,
  };
}

/** The function a borrow calls: a literal, or a declared function it can follow. */
function callbackOf(em: FnEmitter, given: ts.Expression, method: string): Callback {
  if (ts.isArrowFunction(given) || ts.isFunctionExpression(given)) return given;

  const found = ts.isIdentifier(given) ? em.checker.getSymbolAtLocation(given) : undefined;
  const sym =
    found && found.flags & ts.SymbolFlags.Alias ? em.checker.getAliasedSymbol(found) : found;
  const decl = sym?.valueDeclaration;

  if (decl && ts.isFunctionDeclaration(decl) && decl.body) return decl;

  fail(
    given,
    Codes.UnsupportedCall,
    `pass ${method} a function literal or the name of a function, so the compiler can check what it does with the bytes`,
  );
}

/** Refuses a callback that could keep its span past the borrow. */
function checkBorrow(em: FnEmitter, callback: Callback, method: string): void {
  const lent = `${method} lends the bytes only while its callback runs`;
  const modifiers = ts.getModifiers(callback) ?? [];

  if (modifiers.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword))
    fail(
      callback,
      Codes.BorrowEscape,
      `${method}'s callback cannot be async: ${lent}, and \`await\` would hold them past it`,
    );

  if (!ts.isArrowFunction(callback) && callback.asteriskToken)
    fail(callback, Codes.BorrowEscape, `${method}'s callback cannot be a generator: ${lent}`);

  const param = callback.parameters[0];

  if (!param || !ts.isIdentifier(param.name)) return;

  const sym = em.checker.getSymbolAtLocation(param.name);
  const [escape] = sym ? factsOf(em.ctx).escapes(sym) : [];

  if (escape) fail(param, Codes.BorrowEscape, `${escape.message}; ${lent}`);
}

// --- moves -----------------------------------------------------------------------

/**
 * The buffers a compute input names directly (`buffer`, `{ buffer }`,
 * `[a, b]`): each moves to the task.
 */
export function movedByInput(em: FnEmitter, input: ts.Expression): ts.Identifier[] {
  const visit = (e: ts.Expression): ts.Identifier[] => {
    if (ts.isParenthesizedExpression(e) || ts.isAsExpression(e) || ts.isNonNullExpression(e))
      return visit(e.expression);

    if (ts.isIdentifier(e)) return em.lt(e).k === "buffer" ? [e] : [];

    if (ts.isArrayLiteralExpression(e))
      return e.elements.flatMap((x) => (ts.isSpreadElement(x) ? [] : visit(x)));

    if (ts.isObjectLiteralExpression(e))
      return e.properties.flatMap((p) =>
        ts.isShorthandPropertyAssignment(p)
          ? visit(p.name)
          : ts.isPropertyAssignment(p)
            ? visit(p.initializer)
            : [],
      );

    return [];
  };

  return visit(input);
}

/**
 * Reports the first use of the local buffer `moved` after `move`, when
 * `move` certainly ran before it: later statements of the same block, up
 * to an assignment of a new buffer. Closing a moved buffer does nothing,
 * so it is not a use.
 */
export function refuseLaterUse(
  em: FnEmitter,
  moved: ts.Expression,
  move: ts.Node,
  what: string,
): void {
  const sym = ts.isIdentifier(moved) ? variableAt(em.checker, moved) : undefined;
  const decl = sym?.valueDeclaration;

  if (!sym || !decl || !(ts.isVariableDeclaration(decl) || ts.isParameter(decl))) return;

  if (functionOf(decl) !== functionOf(move)) return;

  const statement = definiteStatement(move);
  const list = statement && statementsOf(statement.parent);

  if (!list) return;

  for (const later of list.slice(list.indexOf(statement) + 1)) {
    const found = useIn(em.checker, later, sym);

    if (found === "reassigned") return;

    if (found)
      fail(
        found,
        Codes.UseAfterMove,
        `\`${sym.name}\` is used after ${what} (${where(move)}): a moved buffer refuses every use`,
      );
  }
}

/** The variable an identifier names; `{ buffer }` names the variable, not the property. */
function variableAt(checker: ts.TypeChecker, id: ts.Identifier): ts.Symbol | undefined {
  return ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id
    ? checker.getShorthandAssignmentValueSymbol(id.parent)
    : checker.getSymbolAtLocation(id);
}

function functionOf(node: ts.Node): ts.Node | undefined {
  return ts.findAncestor(node.parent, (n) => ts.isFunctionLike(n) || ts.isSourceFile(n));
}

function where(node: ts.Node): string {
  const sf = node.getSourceFile();
  const { line, character } = sf.getLineAndCharacterOfPosition(node.getStart(sf));

  return `${path.basename(sf.fileName)}:${line + 1}:${character + 1}`;
}

function statementsOf(node: ts.Node): readonly ts.Statement[] | undefined {
  if (ts.isBlock(node) || ts.isSourceFile(node) || ts.isModuleBlock(node)) return node.statements;

  if (ts.isCaseClause(node) || ts.isDefaultClause(node)) return node.statements;

  return undefined;
}

const SHORT_CIRCUITS = new Set([
  ts.SyntaxKind.AmpersandAmpersandToken,
  ts.SyntaxKind.BarBarToken,
  ts.SyntaxKind.QuestionQuestionToken,
  ts.SyntaxKind.AmpersandAmpersandEqualsToken,
  ts.SyntaxKind.BarBarEqualsToken,
  ts.SyntaxKind.QuestionQuestionEqualsToken,
]);

/** Whether `child` runs whenever `parent` runs to its end. */
function runsWith(child: ts.Node, parent: ts.Node): boolean {
  if (ts.isFunctionLike(parent) || ts.isClassLike(parent) || ts.isIterationStatement(parent, false))
    return false;

  if (ts.isConditionalExpression(parent)) return child === parent.condition;

  if (ts.isBinaryExpression(parent) && SHORT_CIRCUITS.has(parent.operatorToken.kind))
    return child === parent.left;

  if (ts.isIfStatement(parent) || ts.isSwitchStatement(parent)) return child === parent.expression;

  if (parent.flags & ts.NodeFlags.OptionalChain)
    return (parent as ts.Node & { expression?: ts.Node }).expression === child;

  return !ts.isTryStatement(parent) && !ts.isCatchClause(parent);
}

/** The statement of a block that certainly runs `node` when it completes; undefined if none does. */
function definiteStatement(node: ts.Node): ts.Statement | undefined {
  let child = node;

  for (let parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (statementsOf(parent)) return child as ts.Statement;

    if (!runsWith(child, parent)) return undefined;
  }

  return undefined;
}

/**
 * The first reference to `sym` in `node`, in the order it runs, but for
 * closing it; "reassigned" if a new value replaces it first. Nested
 * functions may never run: they are not looked into.
 */
function useIn(
  checker: ts.TypeChecker,
  node: ts.Node,
  sym: ts.Symbol,
): ts.Node | "reassigned" | undefined {
  const refers = (n: ts.Node) => ts.isIdentifier(n) && variableAt(checker, n) === sym;

  const visit = (n: ts.Node): ts.Node | "reassigned" | undefined => {
    if (ts.isFunctionLike(n)) return undefined;

    if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind === ts.SyntaxKind.EqualsToken &&
      refers(n.left)
    )
      return visit(n.right) ?? "reassigned";

    if (refers(n)) return isClose(n) ? undefined : n;

    return ts.forEachChild(n, visit);
  };

  return visit(node);
}

/** `buffer.close()`. */
function isClose(id: ts.Node): boolean {
  const access = id.parent;

  return (
    ts.isPropertyAccessExpression(access) &&
    access.expression === id &&
    access.name.text === "close" &&
    ts.isCallExpression(access.parent) &&
    access.parent.expression === access
  );
}
