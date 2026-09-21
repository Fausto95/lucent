/**
 * The only file that imports oxc-parser. Converts the ESTree/TS-ESTree program
 * into the closed surface AST, reporting anything outside the subset.
 */
import { parseSync } from "oxc-parser";
import type * as ES from "@oxc-project/types";
import { diagnostic, type Diagnostic, type Span } from "../diagnostics/index.ts";
import type {
  AssignOperator,
  BinaryOperator,
  Expr,
  ObjectProperty,
  Stmt,
  SurfaceField,
  SurfaceFunction,
  SurfaceImport,
  SurfaceModule,
  SurfaceParam,
  SurfaceType,
  SurfaceTypeAlias,
} from "./surface.ts";

export type * from "./surface.ts";

type ESLiteral =
  | ES.StringLiteral
  | ES.NumericLiteral
  | ES.BooleanLiteral
  | ES.NullLiteral
  | ES.BigIntLiteral
  | ES.RegExpLiteral;

export interface ParseResult {
  module: SurfaceModule;
  diagnostics: Diagnostic[];
}

export const LUCENT_TYPES_MODULE = "@lucent-lang/types";
export const LUCENT_ERROR = "LucentError";

const spanOf = (node: { start: number; end: number }): Span => ({ start: node.start, end: node.end });

/** Human names for ESTree node types that Lucent rejects, used in NT1001 messages. */
const NODE_NAMES: Record<string, string> = {
  SwitchStatement: "switch statement",
  DoWhileStatement: "do…while loop",
  ForInStatement: "for…in loop",
  TryStatement: "try/catch",
  LabeledStatement: "labeled statement",
  WithStatement: "with statement",
  DebuggerStatement: "debugger statement",
  ClassDeclaration: "class declaration",
  ClassExpression: "class expression",
  FunctionExpression: "function expression",
  ArrowFunctionExpression: "arrow function",
  ThisExpression: "`this`",
  NewExpression: "`new` expression",
  SpreadElement: "spread",
  ObjectPattern: "destructuring",
  ArrayPattern: "destructuring",
  RestElement: "rest parameter",
  ConditionalExpression: "conditional expression",
  SequenceExpression: "comma expression",
  ChainExpression: "optional chaining",
  TaggedTemplateExpression: "tagged template",
  TSAsExpression: "type assertion",
  TSSatisfiesExpression: "`satisfies` expression",
  TSNonNullExpression: "non-null assertion",
  TSInterfaceDeclaration: "interface declaration",
  TSEnumDeclaration: "enum declaration",
  TSModuleDeclaration: "namespace declaration",
  ExportDefaultDeclaration: "default export",
  ExportAllDeclaration: "`export *`",
  VariableDeclaration: "top-level variable",
  ExpressionStatement: "top-level statement",
  RegExpLiteral: "regular expression",
  BigIntLiteral: "bigint literal",
  TSTupleType: "tuple type",
  TSFunctionType: "function type",
  TSConditionalType: "conditional type",
  TSMappedType: "mapped type",
  TSIndexedAccessType: "indexed access type",
  TSTypeOperator: "type operator",
  TSLiteralType: "literal type",
  TSIntersectionType: "intersection type",
  TSTypeQuery: "`typeof` type",
};

const BINARY_OPERATORS: ReadonlySet<string> = new Set<BinaryOperator>([
  "+",
  "-",
  "*",
  "/",
  "%",
  "<",
  "<=",
  ">",
  ">=",
  "===",
  "!==",
]);
const ASSIGN_OPERATORS: ReadonlySet<string> = new Set<AssignOperator>(["=", "+=", "-=", "*=", "/="]);

const KEYWORD_TYPES: Record<string, string> = {
  TSNumberKeyword: "number",
  TSStringKeyword: "string",
  TSBooleanKeyword: "boolean",
  TSVoidKeyword: "void",
  TSNullKeyword: "null",
  TSUndefinedKeyword: "undefined",
  TSAnyKeyword: "any",
  TSUnknownKeyword: "unknown",
  TSNeverKeyword: "never",
  TSObjectKeyword: "object",
  TSSymbolKeyword: "symbol",
  TSBigIntKeyword: "bigint",
};

class Converter {
  readonly diagnostics: Diagnostic[] = [];
  readonly imports: SurfaceImport[] = [];
  readonly typeAliases: SurfaceTypeAlias[] = [];
  readonly functions: SurfaceFunction[] = [];

  unsupported(
    node: { type: string; start: number; end: number },
    what = NODE_NAMES[node.type] ?? node.type,
    help?: string,
  ): void {
    this.diagnostics.push(diagnostic("NT1001", spanOf(node), `Unsupported syntax: ${what}.`, help));
  }

  // ---- top level -----------------------------------------------------------

  topLevel(stmt: ES.Statement): void {
    const handler = this.topLevelHandlers[stmt.type];
    if (handler) handler(stmt as never);
    else this.unsupported(stmt);
  }

  private readonly topLevelHandlers: Record<string, (node: never) => void> = {
    ImportDeclaration: (node: ES.ImportDeclaration) => this.importDeclaration(node),
    ExportNamedDeclaration: (node: ES.ExportNamedDeclaration) => this.exportDeclaration(node),
    FunctionDeclaration: (node: ES.Function) => this.functionDeclaration(node, false),
    TSTypeAliasDeclaration: (node: ES.TSTypeAliasDeclaration) => this.typeAlias(node, false),
  };

  private importDeclaration(node: ES.ImportDeclaration): void {
    const source = node.source.value;
    if (source !== LUCENT_TYPES_MODULE) {
      this.diagnostics.push(
        diagnostic(
          "NT1006",
          spanOf(node.source),
          `Lucent modules cannot import "${source}". Only type imports from "${LUCENT_TYPES_MODULE}" are allowed.`,
          "Native code is compiled ahead of time and cannot depend on JavaScript modules.",
        ),
      );
      return;
    }
    const names: string[] = [];
    for (const spec of node.specifiers ?? []) {
      if (spec.type === "ImportSpecifier") names.push(spec.local.name);
      else this.unsupported(spec, "namespace or default import");
    }
    this.imports.push({ source, names, typeOnly: node.importKind === "type", span: spanOf(node) });
  }

  private exportDeclaration(node: ES.ExportNamedDeclaration): void {
    const decl = node.declaration;
    if (!decl) {
      this.unsupported(node, "export list", "Export functions and type aliases directly at their declaration.");
      return;
    }
    if (decl.type === "FunctionDeclaration") this.functionDeclaration(decl, true);
    else if (decl.type === "TSTypeAliasDeclaration") this.typeAlias(decl, true);
    else this.unsupported(decl);
  }

  private typeAlias(node: ES.TSTypeAliasDeclaration, exported: boolean): void {
    if (node.typeParameters) {
      this.unsupported(node.typeParameters, "generic type alias");
      return;
    }
    this.typeAliases.push({ name: node.id.name, exported, type: this.type(node.typeAnnotation), span: spanOf(node) });
  }

  private functionDeclaration(node: ES.Function, exported: boolean): void {
    if (!node.id) {
      this.unsupported(node, "anonymous function");
      return;
    }
    if (node.generator) this.unsupported(node, "generator function");
    if (node.typeParameters) this.unsupported(node.typeParameters, "generic function");
    const params = node.params.map((p) => this.param(p));
    const body = node.body ? this.block(node.body) : [];
    this.functions.push({
      name: node.id.name,
      exported,
      async: node.async,
      params,
      returnType: node.returnType ? this.type(node.returnType.typeAnnotation) : null,
      body,
      span: spanOf(node),
    });
  }

  private param(node: ES.ParamPattern): SurfaceParam {
    if (node.type === "Identifier") {
      return {
        name: node.name,
        optional: node.optional ?? false,
        type: node.typeAnnotation ? this.type(node.typeAnnotation.typeAnnotation) : null,
        span: spanOf(node),
      };
    }
    this.unsupported(node, node.type === "AssignmentPattern" ? "default parameter value" : undefined);
    return { name: "_", optional: false, type: null, span: spanOf(node) };
  }

  // ---- types ---------------------------------------------------------------

  type(node: ES.TSType): SurfaceType {
    const span = spanOf(node);
    const keyword = KEYWORD_TYPES[node.type];
    if (keyword) return { kind: "keyword", name: keyword, span };
    const handler = this.typeHandlers[node.type];
    if (handler) return handler(node as never);
    return { kind: "unsupported", description: NODE_NAMES[node.type] ?? node.type, span };
  }

  private readonly typeHandlers: Record<string, (node: never) => SurfaceType> = {
    TSTypeReference: (node: ES.TSTypeReference) => {
      const span = spanOf(node);
      if (node.typeName.type !== "Identifier") return { kind: "unsupported", description: "qualified type name", span };
      const args = node.typeArguments?.params.map((p) => this.type(p)) ?? [];
      return { kind: "reference", name: node.typeName.name, args, span };
    },
    TSArrayType: (node: ES.TSArrayType) => ({
      kind: "array",
      element: this.type(node.elementType),
      span: spanOf(node),
    }),
    TSUnionType: (node: ES.TSUnionType) => ({
      kind: "union",
      members: node.types.map((t) => this.type(t)),
      span: spanOf(node),
    }),
    TSParenthesizedType: (node: ES.TSParenthesizedType) => this.type(node.typeAnnotation),
    TSFunctionType: (node: ES.TSFunctionType) => ({ kind: "function", span: spanOf(node) }),
    TSTypeLiteral: (node: ES.TSTypeLiteral) => {
      const fields: SurfaceField[] = [];
      for (const member of node.members) {
        if (member.type !== "TSPropertySignature" || member.key.type !== "Identifier" || !member.typeAnnotation) {
          this.unsupported(member, "object type member");
          continue;
        }
        fields.push({
          name: member.key.name,
          optional: member.optional,
          type: this.type(member.typeAnnotation.typeAnnotation),
          span: spanOf(member),
        });
      }
      return { kind: "object", fields, span: spanOf(node) };
    },
  };

  // ---- statements ----------------------------------------------------------

  block(node: ES.BlockStatement): Stmt[] {
    return node.body.map((s) => this.stmt(s));
  }

  /** A loop/if body: a block is flattened, a single statement becomes a one-element list. */
  bodyOf(node: ES.Statement): Stmt[] {
    return node.type === "BlockStatement" ? this.block(node) : [this.stmt(node)];
  }

  stmt(node: ES.Statement): Stmt {
    const handler = this.stmtHandlers[node.type];
    if (handler) return handler(node as never);
    this.unsupported(node);
    return { kind: "unsupported", span: spanOf(node) };
  }

  private readonly stmtHandlers: Record<string, (node: never) => Stmt> = {
    VariableDeclaration: (node: ES.VariableDeclaration) => this.variable(node),
    IfStatement: (node: ES.IfStatement) => ({
      kind: "if",
      test: this.expr(node.test),
      consequent: this.bodyOf(node.consequent),
      alternate: node.alternate ? this.bodyOf(node.alternate) : null,
      span: spanOf(node),
    }),
    WhileStatement: (node: ES.WhileStatement) => ({
      kind: "while",
      test: this.expr(node.test),
      body: this.bodyOf(node.body),
      span: spanOf(node),
    }),
    ForStatement: (node: ES.ForStatement) => ({
      kind: "for",
      init: node.init
        ? node.init.type === "VariableDeclaration"
          ? this.variable(node.init)
          : { kind: "expression", expression: this.expr(node.init), span: spanOf(node.init) }
        : null,
      test: node.test ? this.expr(node.test) : null,
      update: node.update ? this.expr(node.update) : null,
      body: this.bodyOf(node.body),
      span: spanOf(node),
    }),
    ForOfStatement: (node: ES.ForOfStatement) => this.forOf(node),
    ReturnStatement: (node: ES.ReturnStatement) => ({
      kind: "return",
      argument: node.argument ? this.expr(node.argument) : null,
      span: spanOf(node),
    }),
    BreakStatement: (node: ES.BreakStatement) => {
      if (node.label) this.unsupported(node, "labeled break");
      return { kind: "break", span: spanOf(node) };
    },
    ContinueStatement: (node: ES.ContinueStatement) => {
      if (node.label) this.unsupported(node, "labeled continue");
      return { kind: "continue", span: spanOf(node) };
    },
    ThrowStatement: (node: ES.ThrowStatement) => this.throwStmt(node),
    ExpressionStatement: (node: ES.ExpressionStatement) => ({
      kind: "expression",
      expression: this.expr(node.expression),
      span: spanOf(node),
    }),
    BlockStatement: (node: ES.BlockStatement) => ({ kind: "block", body: this.block(node), span: spanOf(node) }),
    EmptyStatement: (node: ES.EmptyStatement) => ({ kind: "block", body: [], span: spanOf(node) }),
  };

  private variable(node: ES.VariableDeclaration): Stmt {
    const span = spanOf(node);
    if (node.kind !== "const" && node.kind !== "let") {
      this.unsupported(node, `\`${node.kind}\` declaration`, "Use `const` or `let`.");
      return { kind: "unsupported", span };
    }
    if (node.declarations.length !== 1) {
      this.unsupported(node, "multiple declarators in one statement", "Declare one variable per statement.");
      return { kind: "unsupported", span };
    }
    const decl = node.declarations[0]!;
    if (decl.id.type !== "Identifier") {
      this.unsupported(decl.id);
      return { kind: "unsupported", span };
    }
    return {
      kind: "variable",
      declaration: node.kind,
      name: decl.id.name,
      type: decl.id.typeAnnotation ? this.type(decl.id.typeAnnotation.typeAnnotation) : null,
      init: decl.init ? this.expr(decl.init) : null,
      span,
    };
  }

  private forOf(node: ES.ForOfStatement): Stmt {
    const span = spanOf(node);
    if (node.await) this.unsupported(node, "`for await`");
    const left = node.left;
    if (
      left.type !== "VariableDeclaration" ||
      left.declarations.length !== 1 ||
      left.declarations[0]!.id.type !== "Identifier"
    ) {
      this.unsupported(left, "for…of binding", "Write `for (const item of items)`.");
      return { kind: "unsupported", span };
    }
    return {
      kind: "forOf",
      variable: left.declarations[0]!.id.name,
      iterable: this.expr(node.right),
      body: this.bodyOf(node.body),
      span,
    };
  }

  private throwStmt(node: ES.ThrowStatement): Stmt {
    const span = spanOf(node);
    const arg = node.argument;
    const help = `Throw \`new ${LUCENT_ERROR}("CODE", { message: "…" })\`.`;
    if (arg.type !== "NewExpression" || arg.callee.type !== "Identifier" || arg.callee.name !== LUCENT_ERROR) {
      this.unsupported(arg, `throwing anything but \`${LUCENT_ERROR}\``, help);
      return { kind: "unsupported", span };
    }
    const [codeArg, optionsArg] = arg.arguments;
    if (!codeArg || codeArg.type !== "Literal" || typeof codeArg.value !== "string") {
      this.unsupported(codeArg ?? arg, `${LUCENT_ERROR} without a string literal code`, help);
      return { kind: "unsupported", span };
    }
    let message: Expr | null = null;
    if (optionsArg) {
      const prop = optionsArg.type === "ObjectExpression" ? optionsArg.properties[0] : undefined;
      if (
        optionsArg.type !== "ObjectExpression" ||
        optionsArg.properties.length !== 1 ||
        !prop ||
        prop.type !== "Property" ||
        prop.key.type !== "Identifier" ||
        prop.key.name !== "message"
      ) {
        this.unsupported(optionsArg, `${LUCENT_ERROR} options other than \`{ message }\``, help);
        return { kind: "unsupported", span };
      }
      message = this.expr(prop.value);
    }
    return { kind: "throw", code: codeArg.value, message, span };
  }

  // ---- expressions ---------------------------------------------------------

  expr(node: ES.Expression): Expr {
    const handler = this.exprHandlers[node.type];
    if (handler) return handler(node as never);
    this.unsupported(node);
    return { kind: "unsupported", span: spanOf(node) };
  }

  private readonly exprHandlers: Record<string, (node: never) => Expr> = {
    Literal: (node: ESLiteral) => this.literal(node),
    TemplateLiteral: (node: ES.TemplateLiteral) => ({
      kind: "template",
      quasis: node.quasis.map((q) => q.value.cooked ?? q.value.raw),
      expressions: node.expressions.map((e) => this.expr(e)),
      span: spanOf(node),
    }),
    ArrayExpression: (node: ES.ArrayExpression) => ({
      kind: "array",
      elements: node.elements.map((e) => {
        if (e === null) {
          this.unsupported(node, "array hole");
          return { kind: "unsupported", span: spanOf(node) } as Expr;
        }
        if (e.type === "SpreadElement") {
          this.unsupported(e);
          return { kind: "unsupported", span: spanOf(e) } as Expr;
        }
        return this.expr(e);
      }),
      span: spanOf(node),
    }),
    ObjectExpression: (node: ES.ObjectExpression) => ({
      kind: "object",
      properties: node.properties.map((p) => this.objectProperty(p)),
      span: spanOf(node),
    }),
    Identifier: (node: ES.IdentifierReference) =>
      node.name === "undefined"
        ? { kind: "undefined", span: spanOf(node) }
        : { kind: "identifier", name: node.name, span: spanOf(node) },
    ParenthesizedExpression: (node: ES.ParenthesizedExpression) => this.expr(node.expression),
    BinaryExpression: (node: ES.BinaryExpression) => this.binary(node),
    LogicalExpression: (node: ES.LogicalExpression) => {
      if (node.operator === "??") {
        this.unsupported(node, "nullish coalescing");
        return { kind: "unsupported", span: spanOf(node) };
      }
      return {
        kind: "logical",
        operator: node.operator,
        left: this.expr(node.left),
        right: this.expr(node.right),
        span: spanOf(node),
      };
    },
    UnaryExpression: (node: ES.UnaryExpression) => {
      if (node.operator !== "-" && node.operator !== "!") {
        this.unsupported(node, `unary \`${node.operator}\``);
        return { kind: "unsupported", span: spanOf(node) };
      }
      return { kind: "unary", operator: node.operator, argument: this.expr(node.argument), span: spanOf(node) };
    },
    AssignmentExpression: (node: ES.AssignmentExpression) => {
      if (!ASSIGN_OPERATORS.has(node.operator)) {
        this.unsupported(node, `assignment operator \`${node.operator}\``);
        return { kind: "unsupported", span: spanOf(node) };
      }
      return {
        kind: "assign",
        operator: node.operator as AssignOperator,
        target: this.target(node.left),
        value: this.expr(node.right),
        span: spanOf(node),
      };
    },
    UpdateExpression: (node: ES.UpdateExpression) => ({
      kind: "update",
      operator: node.operator,
      target: this.target(node.argument),
      span: spanOf(node),
    }),
    CallExpression: (node: ES.CallExpression) => this.call(node),
    MemberExpression: (node: ES.MemberExpression) => this.member(node),
    AwaitExpression: (node: ES.AwaitExpression) => ({
      kind: "await",
      argument: this.expr(node.argument),
      span: spanOf(node),
    }),
  };

  private literal(node: ESLiteral): Expr {
    const span = spanOf(node);
    const v = node.value;
    if (typeof v === "number") return { kind: "number", value: v, span };
    if (typeof v === "string") return { kind: "string", value: v, span };
    if (typeof v === "boolean") return { kind: "boolean", value: v, span };
    if (v === null && node.raw === "null") return { kind: "null", span };
    this.unsupported(node, typeof v === "bigint" ? "bigint literal" : "regular expression");
    return { kind: "unsupported", span };
  }

  private objectProperty(node: ES.ObjectPropertyKind): ObjectProperty {
    const span = spanOf(node);
    if (
      node.type !== "Property" ||
      node.kind !== "init" ||
      node.method ||
      node.key.type !== "Identifier" ||
      node.computed
    ) {
      this.unsupported(node, "object literal member");
      return { name: "_", value: { kind: "unsupported", span }, span };
    }
    return { name: node.key.name, value: this.expr(node.value), span };
  }

  private binary(node: ES.BinaryExpression): Expr {
    const span = spanOf(node);
    if (node.operator === "==" || node.operator === "!=") {
      this.unsupported(node, `loose equality \`${node.operator}\``, `Use \`${node.operator}=\`.`);
      return { kind: "unsupported", span };
    }
    if (!BINARY_OPERATORS.has(node.operator)) {
      this.unsupported(node, `operator \`${node.operator}\``);
      return { kind: "unsupported", span };
    }
    return {
      kind: "binary",
      operator: node.operator as BinaryOperator,
      left: this.expr(node.left),
      right: this.expr(node.right),
      span,
    };
  }

  private target(node: ES.Expression | ES.AssignmentTarget): Expr {
    if (node.type === "Identifier" || node.type === "MemberExpression") return this.expr(node);
    this.unsupported(node, "assignment target");
    return { kind: "unsupported", span: spanOf(node) };
  }

  private call(node: ES.CallExpression): Expr {
    const span = spanOf(node);
    if (node.optional) {
      this.unsupported(node, "optional call");
      return { kind: "unsupported", span };
    }
    const args = node.arguments.map((a) => {
      if (a.type === "SpreadElement") {
        this.unsupported(a);
        return { kind: "unsupported", span: spanOf(a) } as Expr;
      }
      return this.expr(a);
    });
    const callee = node.callee;
    if (callee.type === "Identifier") return { kind: "call", callee: callee.name, args, span };
    if (callee.type === "MemberExpression" && !callee.computed && callee.property.type === "Identifier") {
      return { kind: "methodCall", object: this.expr(callee.object), method: callee.property.name, args, span };
    }
    this.unsupported(callee, "call target");
    return { kind: "unsupported", span };
  }

  private member(node: ES.MemberExpression): Expr {
    const span = spanOf(node);
    if (node.optional) {
      this.unsupported(node, "optional chaining");
      return { kind: "unsupported", span };
    }
    if (node.computed)
      return { kind: "index", object: this.expr(node.object), index: this.expr(node.property as ES.Expression), span };
    if (node.property.type !== "Identifier") {
      this.unsupported(node.property, "private member");
      return { kind: "unsupported", span };
    }
    return { kind: "member", object: this.expr(node.object), property: node.property.name, span };
  }
}

export function parseModule(source: string, fileName: string): ParseResult {
  const result = parseSync(fileName, source, { lang: "ts", sourceType: "module", preserveParens: false });
  const converter = new Converter();
  for (const error of result.errors) {
    if (error.severity !== "Error") continue;
    const label = error.labels[0];
    const span: Span = label ? { start: label.start, end: label.end } : { start: 0, end: 0 };
    converter.diagnostics.push(diagnostic("NT1000", span, error.message, error.helpMessage ?? undefined));
  }
  for (const stmt of result.program.body) converter.topLevel(stmt);
  return {
    module: {
      fileName,
      imports: converter.imports,
      typeAliases: converter.typeAliases,
      functions: converter.functions,
    },
    diagnostics: converter.diagnostics,
  };
}
