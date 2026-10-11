/**
 * Byte arguments a synchronous export reads in place (C-BUFFER v1.4's
 * lent bytes): a `Uint8Array` or `ArrayBuffer` parameter its body only reads
 * while it runs. The boundary then lends JavaScript's own bytes for the
 * call instead of copying them, which no one can tell apart from a copy
 * except by seeing JavaScript's writes during the call, as JavaScript
 * itself would.
 *
 * The check is syntactic and conservative: every use of the parameter,
 * and of each `const` view or alias made from it, is a read in the
 * function's own body (not a closure): its length, an element, a read-only
 * method, iteration, a spread, a copy, or an argument to an SDK call,
 * whose binding copies it. Anything else (a write, a store, a return, a
 * call of the program's own code, an object holding it) keeps the copy.
 */
import ts from "typescript";
import { sdkModuleOf } from "../program.ts";
import { libraryMember } from "../analysis/library.ts";

/** Properties a read of which reads the bytes' size or place. */
const SIZES = new Set(["length", "byteLength", "byteOffset"]);

/** Methods of `Uint8Array` and `ArrayBuffer` that only read their receiver. */
const READS = new Set(["includes", "indexOf", "lastIndexOf", "join", "slice", "toString"]);

/** Library functions that only read the bytes they are given, by name. */
const READERS = new Set([
  "lucent:core.utf8Decode",
  "lucent:core.NativeBuffer.from",
  "ArrayConstructor.from",
]);

/** Whether `fn`'s body only reads the bytes its parameter `param` holds. */
export function onlyReads(
  checker: ts.TypeChecker,
  fn: ts.FunctionLikeDeclaration,
  param: ts.ParameterDeclaration,
): boolean {
  if (!fn.body || !ts.isIdentifier(param.name) || param.initializer || param.dotDotDotToken)
    return false;

  const symbol = checker.getSymbolAtLocation(param.name);

  return !!symbol && usesOnlyRead(checker, fn, symbol);
}

/** Whether every use of `symbol` in `fn`'s body reads it. */
function usesOnlyRead(
  checker: ts.TypeChecker,
  fn: ts.FunctionLikeDeclaration,
  symbol: ts.Symbol,
): boolean {
  let ok = true;

  const visit = (node: ts.Node): void => {
    if (!ok) return;

    if (
      ts.isShorthandPropertyAssignment(node) &&
      checker.getShorthandAssignmentValueSymbol(node) === symbol
    ) {
      ok = false;
      return;
    }

    if (ts.isIdentifier(node)) {
      if (isDeclarationName(node) || checker.getSymbolAtLocation(node) !== symbol) return;

      ok = enclosingFunction(node) === fn && readContext(checker, fn, node);
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(fn.body!);

  return ok;
}

/** Whether `expr`, the bytes or a view of them, is used only to read them. */
function readContext(
  checker: ts.TypeChecker,
  fn: ts.FunctionLikeDeclaration,
  expr: ts.Expression,
): boolean {
  const parent = expr.parent;

  if (ts.isParenthesizedExpression(parent) || ts.isNonNullExpression(parent))
    return readContext(checker, fn, parent);

  if (ts.isPropertyAccessExpression(parent) && parent.expression === expr) {
    const name = parent.name.text;

    if (SIZES.has(name)) return !written(parent);

    // A Uint8Array's buffer: here, only the bytes it views.
    if (name === "buffer") return !written(parent) && readContext(checker, fn, parent);

    const call = parent.parent;

    if (!ts.isCallExpression(call) || call.expression !== parent) return false;

    if (READS.has(name)) return true;

    // A view of the same bytes.
    return name === "subarray" && readContext(checker, fn, call);
  }

  if (ts.isElementAccessExpression(parent) && parent.expression === expr) return !written(parent);

  if (ts.isForOfStatement(parent) && parent.expression === expr) return true;

  if (ts.isSpreadElement(parent) && ts.isArrayLiteralExpression(parent.parent)) return true;

  // A view of them (`new Uint8Array(buffer)`), or a copy (`new Uint8Array(bytes)`).
  if (ts.isNewExpression(parent) && parent.arguments?.[0] === expr)
    return (
      named(checker, parent) === "Uint8ArrayConstructor.new" && readContext(checker, fn, parent)
    );

  if (ts.isCallExpression(parent) && parent.arguments.includes(expr))
    return copiesArguments(checker, parent);

  // An alias or view the function names: its uses must read too.
  if (
    ts.isVariableDeclaration(parent) &&
    parent.initializer === expr &&
    ts.isIdentifier(parent.name) &&
    ts.isVariableDeclarationList(parent.parent) &&
    parent.parent.flags & ts.NodeFlags.Const
  ) {
    const alias = checker.getSymbolAtLocation(parent.name);

    return !!alias && usesOnlyRead(checker, fn, alias);
  }

  return false;
}

/** The library member a call or `new` resolves to: `Uint8ArrayConstructor.new`. */
function named(checker: ts.TypeChecker, call: ts.CallLikeExpression): string | undefined {
  const decl = checker.getResolvedSignature(call)?.declaration;

  return decl && !ts.isJSDocSignature(decl) ? libraryMember(decl)?.name : undefined;
}

/** Whether a call only reads the bytes passed to it: an SDK binding's, which copies them. */
function copiesArguments(checker: ts.TypeChecker, call: ts.CallExpression): boolean {
  const decl = checker.getResolvedSignature(call)?.declaration;

  if (!decl || ts.isJSDocSignature(decl)) return false;

  if (sdkModuleOf(decl.getSourceFile())) return true;

  const name = libraryMember(decl)?.name;

  return !!name && READERS.has(name);
}

/** Whether an element or property is assigned, updated or deleted. */
function written(access: ts.Expression): boolean {
  let node: ts.Node = access;

  while (ts.isParenthesizedExpression(node.parent) || ts.isNonNullExpression(node.parent))
    node = node.parent;

  const parent = node.parent;

  if (ts.isBinaryExpression(parent))
    return (
      parent.left === node &&
      parent.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      parent.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    );

  if (ts.isPrefixUnaryExpression(parent) || ts.isPostfixUnaryExpression(parent))
    return (
      parent.operator === ts.SyntaxKind.PlusPlusToken ||
      parent.operator === ts.SyntaxKind.MinusMinusToken
    );

  // Destructuring targets and `for (x[0] of …)` write too.
  return (
    ts.isDeleteExpression(parent) ||
    ts.isArrayLiteralExpression(parent) ||
    ts.isObjectLiteralElementLike(parent) ||
    ((ts.isForOfStatement(parent) || ts.isForInStatement(parent)) && parent.initializer === node)
  );
}

function isDeclarationName(id: ts.Identifier): boolean {
  const parent = id.parent;

  return (
    (ts.isVariableDeclaration(parent) ||
      ts.isParameter(parent) ||
      ts.isBindingElement(parent) ||
      ts.isFunctionDeclaration(parent)) &&
    parent.name === id
  );
}

function enclosingFunction(node: ts.Node): ts.Node | undefined {
  let n = node.parent;

  while (n && !ts.isFunctionLike(n)) n = n.parent;

  return n;
}
