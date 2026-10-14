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

/**
 * A parameter's own symbol. TypeScript gives a parameter property two, and
 * its name resolves to the property's; the constructor body refers to the
 * parameter's.
 */
export function parameterSymbol(
  checker: ts.TypeChecker,
  p: ts.ParameterDeclaration & { name: ts.Identifier },
): ts.Symbol {
  return ts.isParameterPropertyDeclaration(p, p.parent)
    ? checker.getSymbolsOfParameterPropertyDeclaration(p, p.name.text)[0]!
    : checker.getSymbolAtLocation(p.name)!;
}

/** The function that declares a local variable or parameter, if any. */
export function declaringFunction(sym: ts.Symbol): FunctionLike | undefined {
  const decl = sym.valueDeclaration ?? sym.declarations?.[0];
  if (!decl) return undefined;
  if (
    ts.isFunctionDeclaration(decl) &&
    !isFunctionLike(decl.parent) &&
    ts.isSourceFile(decl.parent)
  )
    return undefined;
  if (
    !(
      ts.isVariableDeclaration(decl) ||
      ts.isParameter(decl) ||
      ts.isBindingElement(decl) ||
      ts.isFunctionDeclaration(decl)
    )
  ) {
    return undefined;
  }
  return enclosingFunction(decl);
}

/** Whether `id` is written: assigned (destructuring included), incremented, or a loop's target. */
export function isWriteTarget(id: ts.Identifier): boolean {
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
  if (
    (ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) &&
    (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)
  ) {
    return true;
  }
  if ((ts.isForOfStatement(p) || ts.isForInStatement(p)) && p.initializer === node) return true;
  return false;
}

const analyses = new WeakMap<
  ts.TypeChecker,
  { files: readonly ts.SourceFile[]; analysis: CaptureAnalysis }
>();

/**
 * Finds locals that closures capture and that are written after their
 * declaration. Those live in a shared box so every closure and the enclosing
 * function see one variable, as in JavaScript.
 */
export class CaptureAnalysis {
  readonly boxed = new Set<ts.Symbol>();
  /**
   * `let` and `const` locals a closure made before their declaration
   * captures (a function declaration defined first, or a function written
   * above it): boxed from the start of their block, which the declaration
   * gives its value.
   */
  readonly predeclared = new Set<ts.Symbol>();
  /**
   * Of those, the ones the closure may read before their declaration runs:
   * code the function runs by then may call it. Their box is in its
   * temporal dead zone until the declaration runs.
   */
  readonly early = new Set<ts.Symbol>();
  /**
   * A module's `let` and `const` variables that code may use before their
   * declaration runs: a function or class made before it uses them, and
   * the module's initialization may call it by then (a call in an earlier
   * initializer, or in the variable's own). Each has a flag the module's
   * initialization sets where the declaration runs; until then, a use
   * throws ReferenceError.
   */
  readonly earlyModule = new Set<ts.Symbol>();
  private readonly captured = new Set<ts.Symbol>();
  private readonly written = new Set<ts.Symbol>();
  private readonly checker: ts.TypeChecker;
  /** The uses of each nested function declaration (not its own name, nor in itself). */
  private readonly functionUses = new Map<ts.FunctionDeclaration, ts.Identifier[]>();
  /** definedAt(), by function. */
  private readonly defined = new Map<ts.FunctionDeclaration, number>();
  /** Uses of variables in code made before their declaration, which may run before it does. */
  private readonly deferred: {
    sym: ts.Symbol;
    variable: ts.VariableDeclaration;
    /** The code that declares it: its module, or its function. */
    root: ts.SourceFile | FunctionLike;
    /** The outermost function or class in `root` around the use. */
    container: ts.Node;
  }[] = [];

  /** The analysis of `files`, made once for each checker (the emitter and the effect analysis share it). */
  static of(checker: ts.TypeChecker, files: readonly ts.SourceFile[]): CaptureAnalysis {
    const known = analyses.get(checker);
    if (known && known.files.length === files.length && known.files.every((f, i) => f === files[i]))
      return known.analysis;
    const analysis = new CaptureAnalysis(checker, files);
    analyses.set(checker, { files, analysis });
    return analysis;
  }

  constructor(checker: ts.TypeChecker, files: readonly ts.SourceFile[]) {
    this.checker = checker;
    for (const f of files) this.visit(f);
    this.settleDeferred(files);
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
    if (!owner) {
      this.moduleUse(id, sym);
      return;
    }
    const decl = sym.valueDeclaration ?? sym.declarations?.[0];
    if (decl && (decl as ts.NamedDeclaration).name === id) {
      // A nested function declaration referenced before its definition, or
      // recursively, needs a box too.
      if (ts.isFunctionDeclaration(decl)) this.written.add(sym);
      return;
    }
    if (decl && ts.isFunctionDeclaration(decl) && !isInside(id, decl)) {
      const uses = this.functionUses.get(decl) ?? [];
      uses.push(id);
      this.functionUses.set(decl, uses);
    }
    if (isWriteTarget(id)) this.written.add(sym);
    const user = enclosingFunction(id);
    if (user && user !== owner) {
      this.captured.add(sym);
      this.defer(id, sym, decl, owner);
      // A closure in the variable's own initializer (a recursive arrow)
      // needs the variable to exist before the closure is created.
      if (
        decl &&
        ts.isVariableDeclaration(decl) &&
        decl.initializer &&
        isInside(id, decl.initializer)
      )
        this.written.add(sym);
    }
  }

  isBoxed(sym: ts.Symbol): boolean {
    return this.boxed.has(sym);
  }

  isEarly(sym: ts.Symbol): boolean {
    return this.early.has(sym);
  }

  isPredeclared(sym: ts.Symbol): boolean {
    return this.predeclared.has(sym);
  }

  /**
   * Where the nested function declaration `f` is defined: where it is
   * written, or before, at its first use (in its function's own code, or
   * where the closure using it is made); at its block's start when another
   * function declaration of the block uses it.
   */
  definedAt(f: ts.FunctionDeclaration): number {
    const known = this.defined.get(f);
    if (known !== undefined) return known;
    // While it is worked out (functions that use each other): its block's start.
    const start = f.parent.getStart();
    this.defined.set(f, start);
    const owner = enclosingFunction(f);
    let at = f.getStart();
    for (const use of this.functionUses.get(f) ?? []) {
      const container = owner && containerOf(use, owner);
      at = Math.min(at, container ? this.madeAt(container) : use.getStart());
    }
    this.defined.set(f, at);
    return at;
  }

  /**
   * Where a container is made: a function declaration at the module's
   * start, or where its function defines it (definedAt); the rest where
   * written.
   */
  private madeAt(container: ts.Node): number {
    if (!ts.isFunctionDeclaration(container)) return container.getStart();
    return ts.isSourceFile(container.parent) ? 0 : this.definedAt(container);
  }

  isEarlyModule(sym: ts.Symbol): boolean {
    return this.earlyModule.has(sym);
  }

  /** Whether code may use `sym`, a local or a module variable, before its declaration runs. */
  isDead(sym: ts.Symbol): boolean {
    return this.early.has(sym) || this.earlyModule.has(sym);
  }

  /** A use of a module variable, kept when it is in code that may run later than where it is written. */
  private moduleUse(id: ts.Identifier, used: ts.Symbol): void {
    const sym = used.flags & ts.SymbolFlags.Alias ? this.checker.getAliasedSymbol(used) : used;
    const decl = sym.valueDeclaration ?? sym.declarations?.[0];
    const variable = decl && letOrConst(decl);
    if (variable && ts.isSourceFile(variable.parent.parent.parent))
      this.defer(id, sym, decl, variable.getSourceFile());
  }

  /** Keeps a use of `sym` in a function or class made before its declaration ends. */
  private defer(
    id: ts.Identifier,
    sym: ts.Symbol,
    decl: ts.Declaration | undefined,
    root: ts.SourceFile | FunctionLike,
  ): void {
    const variable = decl && letOrConst(decl);
    if (!variable || variable.name === id) return;
    const file = id.getSourceFile();
    // Another module's use, even where that module runs it: only an import cycle can make it early.
    if (file !== variable.getSourceFile()) {
      this.deferred.push({ sym, variable, root, container: containerOf(id, file) ?? file });
      return;
    }
    const container = containerOf(id, root);
    if (container !== undefined) this.deferred.push({ sym, variable, root, container });
  }

  /**
   * Which deferred uses may run before their variable's declaration: code
   * the declaring function or module runs after the use's code is made and
   * by the declaration's end reaches it (ModuleStart); across an import
   * cycle, any code the cycle's modules run may, since they start in an
   * order of their own.
   */
  private settleDeferred(files: readonly ts.SourceFile[]): void {
    if (!this.deferred.length) return;
    const starts = new Map<ts.Node, CodeStart>();
    const start = (root: ts.SourceFile | FunctionLike) => {
      let known = starts.get(root);
      if (!known) starts.set(root, (known = new CodeStart(this.checker, root)));
      return known;
    };
    const cycles = importCycles(this.checker, files);
    for (const { sym, variable, root, container } of this.deferred) {
      if (this.early.has(sym) || this.earlyModule.has(sym)) continue;
      const home = variable.getSourceFile();
      const from = container.getSourceFile();
      const cycle = ts.isSourceFile(root) ? cycles.get(home) : undefined;
      if (cycle?.has(from) && [...cycle].some((f) => start(f).runs)) {
        this.earlyModule.add(sym);
        continue;
      }
      const made = from === home ? this.madeAt(container) : Infinity;
      if (made > variable.getEnd()) continue;
      // A local: its closure holds its box, made first.
      if (!ts.isSourceFile(root)) {
        this.predeclared.add(sym);
        this.written.add(sym);
      }
      if (!start(root).reaches(container, made, variable.getEnd())) continue;
      if (ts.isSourceFile(root)) this.earlyModule.add(sym);
      else this.early.add(sym);
    }
  }
}

/**
 * The code around `n` in `root` that may run later than the code it is
 * written in: the outermost function or class below `root`.
 */
function containerOf(n: ts.Node, root: ts.Node): ts.Node | undefined {
  let found: ts.Node | undefined;
  for (let p: ts.Node | undefined = n; p && p !== root; p = p.parent) {
    if (ts.isSourceFile(p)) return undefined;
    if (isFunctionLike(p) || ts.isClassLike(p)) found = p;
  }
  return found;
}

/**
 * What a module or a function runs in its own code (not the functions and
 * classes it makes, which run later), in order: each call, `new`, tagged
 * template, getter or setter, and spread or string conversion of an object
 * (a run), and in a function each `return`, `throw`, `await` and `yield`
 * (where other code runs). What each of them names (the functions and
 * classes written in it, or that its names refer to, a variable standing
 * for its initializer), or an assignment does, escapes: every later run
 * may run it, and what it names in turn.
 */
class CodeStart {
  private readonly checker: ts.TypeChecker;
  private readonly root: ts.SourceFile | FunctionLike;
  private readonly events: { at: number; node: ts.Node; runs: boolean }[] = [];
  /** What may have run by each event, in order. */
  private reached?: Set<ts.Node>[];
  /** What each container's code names, and each variable's initializer. */
  private readonly named = new Map<ts.Node, Set<ts.Node>>();

  constructor(checker: ts.TypeChecker, root: ts.SourceFile | FunctionLike) {
    this.checker = checker;
    this.root = root;
    if (ts.isSourceFile(root)) for (const s of root.statements) this.scan(s);
    else if (root.body) this.scan(root.body);
    this.events.sort((a, b) => a.at - b.at);
  }

  /** Whether it runs any code of its own. */
  get runs(): boolean {
    return this.events.some((e) => e.runs);
  }

  /** Whether code it runs after `made` and by `by` may run `container`. */
  reaches(container: ts.Node, made: number, by: number): boolean {
    this.reached ??= this.reach();
    return this.events.some(
      (e, i) => e.runs && e.at > made && e.at <= by && this.reached![i]!.has(container),
    );
  }

  private reach(): Set<ts.Node>[] {
    const out: Set<ts.Node>[] = [];
    const escaped = new Set<ts.Node>();
    const work: ts.Node[] = [];
    for (const e of this.events) {
      work.push(...this.names(e.node, undefined));
      while (work.length) {
        const c = work.pop()!;
        if (escaped.has(c)) continue;
        escaped.add(c);
        work.push(...this.names(c, c));
      }
      out.push(new Set(escaped));
    }
    return out;
  }

  /** Finds the events in code it runs where it is written. */
  private scan(n: ts.Node): void {
    if (isFunctionLike(n)) return;
    if (ts.isClassLike(n)) {
      // Its heritage, computed names and static members run where it is.
      for (const h of n.heritageClauses ?? []) this.scan(h);
      for (const m of n.members) {
        if (m.name && ts.isComputedPropertyName(m.name)) this.scan(m.name);
        if (ts.isClassStaticBlockDeclaration(m)) this.scan(m.body);
        else if (ts.isPropertyDeclaration(m) && isStatic(m) && m.initializer)
          this.scan(m.initializer);
      }
      return;
    }
    // Where it runs: after its operands.
    if (this.runsCode(n)) this.events.push({ at: n.getEnd(), node: n, runs: true });
    else if (
      ts.isReturnStatement(n) ||
      ts.isThrowStatement(n) ||
      ts.isAwaitExpression(n) ||
      ts.isYieldExpression(n)
    )
      this.events.push({ at: n.getEnd(), node: n, runs: true });
    else if (
      ts.isBinaryExpression(n) &&
      n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
      n.operatorToken.kind <= ts.SyntaxKind.LastAssignment
    )
      this.events.push({ at: n.getEnd(), node: n.right, runs: false });
    ts.forEachChild(n, (c) => this.scan(c));
  }

  private runsCode(n: ts.Node): boolean {
    if (
      ts.isCallExpression(n) ||
      ts.isNewExpression(n) ||
      ts.isTaggedTemplateExpression(n) ||
      ts.isDecorator(n)
    )
      return true;
    if (ts.isPropertyAccessExpression(n) || ts.isElementAccessExpression(n)) {
      const member = this.checker.getSymbolAtLocation(
        ts.isPropertyAccessExpression(n) ? n.name : n.argumentExpression,
      );
      return !!member && !!(member.flags & ts.SymbolFlags.Accessor);
    }
    return this.converted(n) !== undefined;
  }

  /** An object a spread, template or `+` converts, which runs its methods. */
  private converted(n: ts.Node): ts.Expression[] | undefined {
    const objects = (es: ts.Expression[]) => {
      const out = es.filter((e) => this.checker.getTypeAtLocation(e).flags & ts.TypeFlags.Object);
      return out.length ? out : undefined;
    };
    if (ts.isSpreadElement(n) || ts.isSpreadAssignment(n) || ts.isTemplateSpan(n))
      return objects([n.expression]);
    if (ts.isBinaryExpression(n) && n.operatorToken.kind === ts.SyntaxKind.PlusToken)
      return objects([n.left, n.right]);
    return undefined;
  }

  /**
   * The containers code names: functions and classes written in it, and
   * those its names refer to, a variable standing for what its initializer
   * names. Inside `container` (its own code), nested ones are its own.
   */
  private names(n: ts.Node, container: ts.Node | undefined): Set<ts.Node> {
    const known = container && this.named.get(container);
    if (known) return known;
    const out = new Set<ts.Node>();
    if (container) this.named.set(container, out);
    const add = (decl: ts.Node) => {
      if (decl.getSourceFile() !== this.root.getSourceFile() || !isInside(decl, this.root)) return;
      const c = containerOf(decl, this.root);
      if (c) out.add(c);
      else if (ts.isVariableDeclaration(decl) && decl.initializer)
        for (const d of this.variable(decl)) out.add(d);
    };
    const visit = (m: ts.Node): void => {
      if ((isFunctionLike(m) || ts.isClassLike(m)) && m !== container) {
        const c = containerOf(m, this.root);
        if (c && c !== container) {
          out.add(c);
          return;
        }
      }
      if (ts.isIdentifier(m)) {
        const found = symbolOf(this.checker, m);
        const sym =
          found && found.flags & ts.SymbolFlags.Alias
            ? this.checker.getAliasedSymbol(found)
            : found;
        for (const d of sym?.declarations ?? []) add(d);
      }
      for (const e of this.converted(m) ?? [])
        for (const d of this.checker.getTypeAtLocation(e).getSymbol()?.declarations ?? []) add(d);
      ts.forEachChild(m, visit);
    };
    visit(n);
    return out;
  }

  /** What a variable's initializer names (a variable named stands for it). */
  private variable(decl: ts.VariableDeclaration): Set<ts.Node> {
    const known = this.named.get(decl);
    if (known) return known;
    const out = new Set<ts.Node>();
    this.named.set(decl, out);
    for (const c of this.names(decl.initializer!, undefined)) out.add(c);
    return out;
  }
}

function isStatic(m: ts.ClassElement): boolean {
  return !!(ts.getCombinedModifierFlags(m as ts.Declaration) & ts.ModifierFlags.Static);
}

/** The files of each import cycle among `files`, by file. */
function importCycles(
  checker: ts.TypeChecker,
  files: readonly ts.SourceFile[],
): Map<ts.SourceFile, Set<ts.SourceFile>> {
  const known = new Set(files);
  const imports = new Map(
    files.map((f) => [
      f,
      f.statements.flatMap((s) => {
        if (!ts.isImportDeclaration(s)) return [];
        const target = checker.getSymbolAtLocation(s.moduleSpecifier)?.valueDeclaration;
        return target && ts.isSourceFile(target) && known.has(target) ? [target] : [];
      }),
    ]),
  );
  const reaches = (from: ts.SourceFile, to: ts.SourceFile): boolean => {
    const seen = new Set<ts.SourceFile>();
    const stack = [...imports.get(from)!];
    while (stack.length) {
      const f = stack.pop()!;
      if (f === to) return true;
      if (seen.has(f)) continue;
      seen.add(f);
      stack.push(...imports.get(f)!);
    }
    return false;
  };
  const out = new Map<ts.SourceFile, Set<ts.SourceFile>>();
  for (const f of files) {
    if (!reaches(f, f)) continue;
    const cycle = new Set(files.filter((g) => g === f || (reaches(f, g) && reaches(g, f))));
    out.set(f, cycle);
  }
  return out;
}

/** The declaration of a `let` or `const` variable `decl` names (destructured too). */
function letOrConst(decl: ts.Declaration): ts.VariableDeclaration | undefined {
  let n: ts.Node = decl;
  while (ts.isBindingElement(n) || ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n))
    n = n.parent;
  if (!ts.isVariableDeclaration(n) || !ts.isVariableDeclarationList(n.parent)) return undefined;
  const scoped = n.parent.flags & ts.NodeFlags.BlockScoped;
  return scoped === ts.NodeFlags.Let || scoped === ts.NodeFlags.Const ? n : undefined;
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
