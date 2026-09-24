import ts from "typescript";

/** Function-like nodes that create a new variable scope for captures. */
export type FunctionLike =
  | ts.FunctionDeclaration
  | ts.FunctionExpression
  | ts.ArrowFunction
  | ts.MethodDeclaration
  | ts.ConstructorDeclaration
  | ts.GetAccessorDeclaration
  | ts.SetAccessorDeclaration;

export function isFunctionLike(n: ts.Node): n is FunctionLike {
  return (
    ts.isFunctionDeclaration(n) ||
    ts.isFunctionExpression(n) ||
    ts.isArrowFunction(n) ||
    ts.isMethodDeclaration(n) ||
    ts.isConstructorDeclaration(n) ||
    ts.isGetAccessorDeclaration(n) ||
    ts.isSetAccessorDeclaration(n)
  );
}

export function enclosingFunction(n: ts.Node): FunctionLike | undefined {
  let p = n.parent;
  while (p) {
    if (isFunctionLike(p)) return p;
    p = p.parent;
  }
  return undefined;
}

/** Symbol referenced by an identifier, looking through shorthand properties. */
export function symbolOf(checker: ts.TypeChecker, id: ts.Identifier): ts.Symbol | undefined {
  if (ts.isShorthandPropertyAssignment(id.parent) && id.parent.name === id) {
    return checker.getShorthandAssignmentValueSymbol(id.parent);
  }
  return checker.getSymbolAtLocation(id);
}

/** The function that declares a local variable or parameter, if any. */
export function declaringFunction(sym: ts.Symbol): FunctionLike | undefined {
  const decl = sym.valueDeclaration ?? sym.declarations?.[0];
  if (!decl) return undefined;
  if (ts.isFunctionDeclaration(decl) && !isFunctionLike(decl.parent) && ts.isSourceFile(decl.parent)) return undefined;
  if (!(ts.isVariableDeclaration(decl) || ts.isParameter(decl) || ts.isBindingElement(decl) || ts.isFunctionDeclaration(decl))) {
    return undefined;
  }
  return enclosingFunction(decl);
}

function isWriteTarget(id: ts.Identifier): boolean {
  let node: ts.Node = id;
  // Destructuring assignment targets: walk up through array/object literals.
  while (
    node.parent &&
    (ts.isArrayLiteralExpression(node.parent) ||
      ts.isObjectLiteralExpression(node.parent) ||
      ts.isShorthandPropertyAssignment(node.parent) ||
      ts.isPropertyAssignment(node.parent) ||
      ts.isSpreadElement(node.parent) ||
      ts.isParenthesizedExpression(node.parent))
  ) {
    if (ts.isPropertyAssignment(node.parent) && node.parent.name === node) return false;
    node = node.parent;
  }
  const p = node.parent;
  if (!p) return false;
  if (ts.isBinaryExpression(p) && p.left === node) {
    const k = p.operatorToken.kind;
    return k >= ts.SyntaxKind.FirstAssignment && k <= ts.SyntaxKind.LastAssignment;
  }
  if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) {
    return true;
  }
  if ((ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.initializer === node) return true;
  return false;
}

/**
 * Finds locals that closures capture and that are written after their
 * declaration. Those live in a shared box so every closure and the enclosing
 * function see one variable, as in JavaScript.
 */
export class CaptureAnalysis {
  readonly boxed = new Set<ts.Symbol>();
  private readonly captured = new Set<ts.Symbol>();
  private readonly written = new Set<ts.Symbol>();
  private readonly checker: ts.TypeChecker;

  constructor(checker: ts.TypeChecker, files: readonly ts.SourceFile[]) {
    this.checker = checker;
    for (const f of files) this.visit(f);
    for (const s of this.captured) if (this.written.has(s)) this.boxed.add(s);
  }

  private visit(node: ts.Node): void {
    if (ts.isIdentifier(node)) this.identifier(node);
    ts.forEachChild(node, (c) => this.visit(c));
  }

  private identifier(id: ts.Identifier): void {
    const sym = symbolOf(this.checker, id);
    if (!sym) return;
    const owner = declaringFunction(sym);
    if (!owner) return;
    const decl = sym.valueDeclaration ?? sym.declarations?.[0];
    if (decl && (decl as ts.NamedDeclaration).name === id) {
      // A nested function declaration referenced before its definition, or
      // recursively, needs a box too.
      if (ts.isFunctionDeclaration(decl)) this.written.add(sym);
      return;
    }
    if (isWriteTarget(id)) this.written.add(sym);
    const user = enclosingFunction(id);
    if (user && user !== owner) {
      this.captured.add(sym);
      // A closure in the variable's own initializer (a recursive arrow)
      // needs the variable to exist before the closure is created.
      if (decl && ts.isVariableDeclaration(decl) && decl.initializer && isInside(id, decl.initializer)) this.written.add(sym);
    }
  }

  isBoxed(sym: ts.Symbol): boolean {
    return this.boxed.has(sym);
  }
}

/** Locals of enclosing functions that `fn` references (its captures), in first-use order. */
export function freeVariables(checker: ts.TypeChecker, fn: FunctionLike): ts.Symbol[] {
  const out: ts.Symbol[] = [];
  const seen = new Set<ts.Symbol>();
  const visit = (n: ts.Node) => {
    if (ts.isIdentifier(n)) {
      const sym = symbolOf(checker, n);
      if (sym && !seen.has(sym)) {
        const owner = declaringFunction(sym);
        if (owner && owner !== fn && !isInside(owner, fn) && isInside(fn, owner)) {
          const decl = sym.valueDeclaration ?? sym.declarations?.[0];
          if (!(decl && (decl as ts.NamedDeclaration).name === n)) {
            seen.add(sym);
            out.push(sym);
          }
        }
      }
    }
    ts.forEachChild(n, visit);
  };
  if (fn.body) visit(fn.body);
  for (const p of fn.parameters) if (p.initializer) visit(p.initializer);
  return out;
}

/** Whether `inner` is (strictly or not) inside `outer`. */
export function isInside(inner: ts.Node, outer: ts.Node): boolean {
  let n: ts.Node | undefined = inner;
  while (n) {
    if (n === outer) return true;
    n = n.parent;
  }
  return false;
}

/** Whether `fn`'s body (not nested functions) uses `this`, or a nested arrow does. */
export function usesThis(fn: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (n.kind === ts.SyntaxKind.ThisKeyword) {
      found = true;
      return;
    }
    if (ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n) || ts.isClassLike(n)) return;
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(fn, visit);
  return found;
}

/** Whether a function body contains `await` (outside nested functions). */
export function containsAwait(fn: ts.Node): boolean {
  let found = false;
  const visit = (n: ts.Node) => {
    if (found) return;
    if (ts.isAwaitExpression(n) || (ts.isForOfStatement(n) && n.awaitModifier)) {
      found = true;
      return;
    }
    if (isFunctionLike(n)) return;
    ts.forEachChild(n, visit);
  };
  ts.forEachChild(fn, visit);
  return found;
}
