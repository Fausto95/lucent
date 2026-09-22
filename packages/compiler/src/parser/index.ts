/**
 * The parser boundary imports oxc-parser. Converts the ESTree/TS-ESTree program
 * into the closed surface AST, reporting anything outside the subset.
 */
import { functionDecorators, maskDecorators } from "./decorators.ts";
import type { ThreadContext } from "../libraries.ts";
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

/** Human names for ESTree node types that Lucent rejects, used in LUCENT1001 messages. */
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
  constructor(
    private readonly source: string,
    private readonly threads: ReadonlyMap<number, ThreadContext>,
  ) {}
  readonly diagnostics: Diagnostic[] = [];
  readonly imports: SurfaceImport[] = [];
  readonly typeAliases: SurfaceTypeAlias[] = [];
  readonly functions: SurfaceFunction[] = [];

  unsupported(
    node: { type: string; start: number; end: number },
    what = NODE_NAMES[node.type] ?? node.type,
    help?: string,
  ): void {
    this.diagnostics.push(diagnostic("LUCENT1001", spanOf(node), `Unsupported syntax: ${what}.`, help));
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
    ClassDeclaration: (node: ES.Class) => this.classDeclaration(node, false),
    FunctionDeclaration: (node: ES.Function) => this.functionDeclaration(node, false),
    VariableDeclaration: (node: ES.VariableDeclaration) => this.eventDeclaration(node, false),
    TSTypeAliasDeclaration: (node: ES.TSTypeAliasDeclaration) => this.typeAlias(node, false),
  };

  private importDeclaration(node: ES.ImportDeclaration): void {
    const source = node.source.value;
    if (
      source !== LUCENT_TYPES_MODULE &&
      !source.startsWith("@lucent-lang/") &&
      !/^\.{1,2}\/.*\.lucent(?:\.tsx?)?$/.test(source)
    ) {
      this.diagnostics.push(
        diagnostic(
          "LUCENT1006",
          spanOf(node.source),
          `Lucent modules cannot import "${source}". Only type imports from "${LUCENT_TYPES_MODULE}" are allowed.`,
          "Native code is compiled ahead of time and cannot depend on JavaScript modules.",
        ),
      );
      return;
    }
    const names: string[] = [];
    const bindings: NonNullable<SurfaceImport["bindings"]> = [];
    for (const spec of node.specifiers ?? []) {
      if (spec.type === "ImportSpecifier") {
        names.push(spec.local.name);
        bindings.push({
          imported: spec.imported.type === "Identifier" ? spec.imported.name : spec.imported.value,
          local: spec.local.name,
          typeOnly: node.importKind === "type" || spec.importKind === "type",
        });
      } else this.unsupported(spec, "namespace or default import");
    }
    this.imports.push({
      source,
      names,
      typeOnly: node.importKind === "type",
      span: spanOf(node),
      ...(source === LUCENT_TYPES_MODULE ? {} : { bindings }),
    });
  }

  private exportDeclaration(node: ES.ExportNamedDeclaration): void {
    const decl = node.declaration;
    if (!decl) {
      this.unsupported(node, "export list", "Export functions and type aliases directly at their declaration.");
      return;
    }
    if (decl.type === "FunctionDeclaration" || decl.type === "TSDeclareFunction") this.functionDeclaration(decl, true);
    else if (decl.type === "TSTypeAliasDeclaration") this.typeAlias(decl, true);
    else if (decl.type === "ClassDeclaration") this.classDeclaration(decl, true);
    else if (decl.type === "VariableDeclaration") this.eventDeclaration(decl, true);
    else this.unsupported(decl);
  }

  private classDeclaration(node: ES.Class, exported: boolean): void {
    const base = this.imports
      .find((i) => i.source === "@lucent-lang/objects")
      ?.bindings?.find((b) => b.imported === "SharedObject" && !b.typeOnly)?.local;
    const sharedBase = node.superClass?.type === "Identifier" && node.superClass.name === base;
    if (
      !node.id ||
      (node.superClass && !sharedBase) ||
      node.typeParameters ||
      node.abstract ||
      node.declare ||
      node.decorators.length ||
      node.implements?.length
    ) {
      this.unsupported(node, "class inheritance, generics, decorators, or ambient classes");
      return;
    }
    const name = node.id.name,
      span = spanOf(node);
    const type: SurfaceType = { kind: "reference", name, args: [], span };
    const self: Expr = { kind: "identifier", name: "lucentSelf", span };
    const receiver: SurfaceParam = { name: "lucentSelf", type, optional: false, span };
    const privateFields: string[] = [];
    const fields: SurfaceField[] = [],
      initializers: ObjectProperty[] = [];
    let constructor: ES.Function | undefined;
    for (const member of node.body.body) {
      if (
        (member.type !== "PropertyDefinition" && member.type !== "MethodDefinition") ||
        member.static ||
        member.computed ||
        member.key.type !== "Identifier" ||
        member.decorators.length ||
        (member.accessibility &&
          member.accessibility !== "public" &&
          !(member.type === "PropertyDefinition" && member.accessibility === "private"))
      ) {
        this.unsupported(
          member,
          "native class member (only public/private instance fields and public methods are supported)",
        );
        continue;
      }
      const key = member.key.name,
        at = spanOf(member);
      if (["dispose", "lucentSelf"].includes(key) || key.startsWith("__lucent")) {
        this.unsupported(member, "reserved native class member name");
        continue;
      }
      if (member.type === "PropertyDefinition") {
        if (!member.typeAnnotation || !member.value || member.optional || member.readonly) {
          this.unsupported(member, "native fields require a type and initializer");
          continue;
        }
        const fieldType = this.type(member.typeAnnotation.typeAnnotation);
        fields.push({ name: key, type: fieldType, optional: false, span: at });
        initializers.push({ name: key, value: this.expr(member.value), span: at });
        if (member.accessibility === "private") {
          privateFields.push(key);
          continue;
        }
        const value: Expr = { kind: "member", object: self, property: key, span: at };
        this.functions.push({
          name: `${name}__get_${key}`,
          exported,
          async: false,
          params: [receiver],
          returnType: fieldType,
          body: [{ kind: "return", argument: value, span: at }],
          span: at,
          classOp: { className: name, member: key, kind: "get" },
        });
        this.functions.push({
          name: `${name}__set_${key}`,
          exported,
          async: false,
          params: [receiver, { name: "value", type: fieldType, optional: false, span: at }],
          returnType: { kind: "keyword", name: "void", span: at },
          body: [
            {
              kind: "expression",
              expression: {
                kind: "assign",
                operator: "=",
                target: value,
                value: { kind: "identifier", name: "value", span: at },
                span: at,
              },
              span: at,
            },
          ],
          span: at,
          classOp: { className: name, member: key, kind: "set" },
        });
      } else if (member.type === "MethodDefinition" && member.kind === "constructor") constructor = member.value;
      else if (member.type === "MethodDefinition") {
        if (
          member.kind !== "method" ||
          member.value.async ||
          member.value.generator ||
          member.value.typeParameters ||
          !member.value.returnType
        ) {
          this.unsupported(member, "native methods must be synchronous with an explicit return type");
          continue;
        }
        this.functions.push({
          name: `${name}__method_${key}`,
          exported,
          async: false,
          params: [receiver, ...member.value.params.map((p) => this.param(p))],
          returnType: this.type(member.value.returnType.typeAnnotation),
          body: member.value.body ? this.block(member.value.body) : [],
          span: at,
          classOp: { className: name, member: key, kind: "method" },
        });
      }
    }
    this.typeAliases.push({
      name,
      exported,
      type: { kind: "object", fields, span },
      span,
      reference: { publicName: name, exported, ...(privateFields.length ? { privateFields } : {}) },
    });
    this.functions.push({
      name: `${name}__create`,
      exported,
      async: false,
      params: constructor?.params.map((p) => this.param(p)) ?? [],
      returnType: type,
      body: [
        {
          kind: "variable",
          declaration: "const",
          name: "lucentSelf",
          type,
          init: { kind: "object", properties: initializers, span },
          span,
        },
        ...(constructor?.body
          ? constructor.body.body.flatMap((stmt) => {
              if (
                sharedBase &&
                stmt.type === "ExpressionStatement" &&
                stmt.expression.type === "CallExpression" &&
                stmt.expression.callee.type === "Super" &&
                !stmt.expression.arguments.length
              )
                return [];
              return [this.stmt(stmt)];
            })
          : []),
        { kind: "return", argument: self, span },
      ],
      span,
      classOp: { className: name, member: "constructor", kind: "constructor" },
    });
  }

  private eventDeclaration(node: ES.VariableDeclaration, exported: boolean): void {
    for (const decl of node.declarations) {
      const init = decl.init;
      const eventFactory = this.imports
        .find((i) => i.source === "@lucent-lang/events")
        ?.bindings?.find((b) => b.imported === "event" && !b.typeOnly)?.local;
      if (
        node.kind !== "const" ||
        decl.id.type !== "Identifier" ||
        init?.type !== "CallExpression" ||
        init.callee.type !== "Identifier" ||
        init.callee.name !== eventFactory ||
        init.arguments.length ||
        init.typeArguments?.params.length !== 1
      ) {
        this.unsupported(node, "top-level variable (only const event<T>() declarations are supported)");
        continue;
      }
      const span = spanOf(decl);
      const payload = this.type(init.typeArguments.params[0]!);
      this.functions.push({
        name: decl.id.name,
        exported,
        async: false,
        params:
          payload.kind === "keyword" && payload.name === "void"
            ? []
            : [{ name: "payload", optional: false, type: payload, span }],
        returnType: { kind: "keyword", name: "void", span },
        body: [],
        span,
        event: { name: decl.id.name, id: "", exported },
      });
    }
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
    if ("generator" in node && node.generator) this.unsupported(node, "generator function");
    if (node.typeParameters) this.unsupported(node.typeParameters, "generic function");
    const params = node.params.map((p) => this.param(p));
    const body = "body" in node && node.body ? this.block(node.body) : [];
    this.functions.push({
      ...(node.type === "TSDeclareFunction" ? { ambient: true } : {}),
      name: node.id.name,
      ...this.threadAnnotation(node.start),
      exported,
      async: node.async,
      params,
      returnType: node.returnType ? this.type(node.returnType.typeAnnotation) : null,
      body,
      span: spanOf(node),
    });
  }

  private threadAnnotation(start: number): { thread?: "main" | "worker" | "caller" } {
    const match = this.source
      .slice(0, start)
      .match(/\/\*\*([^*]*(?:\*(?!\/)[^*]*)*)\*\/\s*(?:export\s+)?(?:async\s+)?$/);
    if (match?.[1]?.includes("@thread"))
      this.diagnostics.push(
        diagnostic(
          "LUCENT1001",
          { start, end: start },
          "Thread comment annotations have been replaced by @MainThread, @Background, and @Inherited.",
        ),
      );
    const thread = this.threads.get(start);
    return thread ? { thread } : {};
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
    TSLiteralType: (node: ES.TSLiteralType) =>
      node.literal.type === "Literal" && typeof node.literal.value === "string"
        ? { kind: "literal", value: node.literal.value, span: spanOf(node) }
        : { kind: "unsupported", description: "non-string literal type", span: spanOf(node) },
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
    TSFunctionType: (node: ES.TSFunctionType) => ({
      kind: "function",
      params: node.params.map((p) => this.param(p)),
      returnType: this.type(node.returnType.typeAnnotation),
      span: spanOf(node),
    }),
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
    const metadata: { name: string; value: Expr }[] = [];
    if (arg.arguments.length > 2) this.unsupported(arg, "extra LucentError arguments", help);
    if (optionsArg) {
      if (optionsArg.type !== "ObjectExpression") {
        this.unsupported(optionsArg, "nonliteral LucentError options", help);
        return { kind: "unsupported", span };
      }
      const seen = new Set<string>();
      for (const prop of optionsArg.properties) {
        if (
          prop.type !== "Property" ||
          prop.computed ||
          prop.method ||
          prop.key.type !== "Identifier" ||
          seen.has(prop.key.name)
        ) {
          this.unsupported(prop, "invalid LucentError option", help);
          continue;
        }
        seen.add(prop.key.name);
        if (prop.key.name === "message") message = this.expr(prop.value);
        else if (prop.key.name === "metadata" && prop.value.type === "ObjectExpression") {
          const names = new Set<string>();
          for (const entry of prop.value.properties) {
            if (
              entry.type !== "Property" ||
              entry.computed ||
              entry.method ||
              entry.key.type !== "Identifier" ||
              names.has(entry.key.name)
            ) {
              this.unsupported(entry, "invalid error metadata field");
              continue;
            }
            names.add(entry.key.name);
            metadata.push({ name: entry.key.name, value: this.expr(entry.value) });
          }
        } else this.unsupported(prop, "unknown LucentError option or nonliteral metadata", help);
      }
    }
    return { kind: "throw", code: codeArg.value, message, ...(metadata.length ? { metadata } : {}), span };
  }

  // ---- expressions ---------------------------------------------------------

  expr(node: ES.Expression): Expr {
    const handler = this.exprHandlers[node.type];
    if (handler) return handler(node as never);
    this.unsupported(node);
    return { kind: "unsupported", span: spanOf(node) };
  }

  private readonly exprHandlers: Record<string, (node: never) => Expr> = {
    ArrowFunctionExpression: (node: ES.ArrowFunctionExpression) => {
      if (node.async || node.typeParameters) {
        this.unsupported(node, "native closures must be synchronous");
        return { kind: "unsupported", span: spanOf(node) };
      }
      const params = node.params.map((p) => this.param(p));
      const returnType = node.returnType ? this.type(node.returnType.typeAnnotation) : null;
      const span = spanOf(node);
      if (node.body.type !== "BlockStatement")
        return { kind: "closure", params, returnType, body: this.expr(node.body), span };
      const only =
        node.body.body.length === 1 && node.body.body[0]?.type === "ReturnStatement"
          ? node.body.body[0].argument
          : null;
      if (only) return { kind: "closure", params, returnType, body: this.expr(only), span };
      return { kind: "closure", params, returnType, body: this.block(node.body), span };
    },
    ConditionalExpression: (node: ES.ConditionalExpression) => ({
      kind: "conditional",
      test: this.expr(node.test),
      consequent: this.expr(node.consequent),
      alternate: this.expr(node.alternate),
      span: spanOf(node),
    }),
    ThisExpression: (node: ES.ThisExpression) => ({ kind: "identifier", name: "lucentSelf", span: spanOf(node) }),
    NewExpression: (node: ES.NewExpression) => {
      if (
        node.callee.type !== "Identifier" ||
        node.typeArguments ||
        node.arguments.some((a) => a.type === "SpreadElement")
      ) {
        this.unsupported(node);
        return { kind: "unsupported", span: spanOf(node) };
      }
      return {
        kind: "call",
        callee: `${node.callee.name}__create`,
        args: node.arguments.map((a) => this.expr(a as ES.Expression)),
        span: spanOf(node),
      };
    },
    JSXElement: (node: ES.JSXElement) => this.jsx(node),
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

  private jsx(node: ES.JSXElement): Expr {
    const opening = node.openingElement;
    const span = spanOf(node);
    if (opening.name.type !== "JSXIdentifier") {
      this.unsupported(node, "namespaced JSX name");
      return { kind: "unsupported", span };
    }
    const properties: ObjectProperty[] = [];
    for (const attribute of opening.attributes) {
      if (attribute.type !== "JSXAttribute" || attribute.name.type !== "JSXIdentifier") {
        this.unsupported(attribute, "JSX spread or namespaced attribute");
        continue;
      }
      const v = attribute.value;
      let value: Expr;
      if (!v) value = { kind: "boolean", value: true, span: spanOf(attribute) };
      else if (v.type === "Literal") value = { kind: "string", value: String(v.value), span: spanOf(v) };
      else if (v.type === "JSXExpressionContainer" && v.expression.type !== "JSXEmptyExpression")
        value = this.expr(v.expression);
      else {
        this.unsupported(attribute);
        continue;
      }
      properties.push({ name: attribute.name.name, value, span: spanOf(attribute) });
    }
    const children: Expr[] = [];
    for (const child of node.children) {
      if (child.type === "JSXText") {
        const text = child.value
          .split(/\r?\n/)
          .map((line, i, all) => (i === 0 && all.length === 1 ? line : line.trim()))
          .filter(Boolean)
          .join(" ");
        if (text) children.push({ kind: "string", value: text, span: spanOf(child) });
      } else if (child.type === "JSXElement") children.push(this.jsx(child));
      else if (child.type === "JSXExpressionContainer" && child.expression.type !== "JSXEmptyExpression")
        children.push(this.expr(child.expression));
      else if (child.type !== "JSXExpressionContainer") this.unsupported(child);
    }
    return { kind: "view", name: opening.name.name, properties, children, span };
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
  const masked = maskDecorators(source);
  const result = parseSync(fileName, masked.source, {
    lang: fileName.endsWith(".tsx") ? "tsx" : "ts",
    sourceType: "module",
    preserveParens: false,
  });
  const decorators = functionDecorators(source, masked.source, result.program.body, masked.decorators, result.comments);
  const converter = new Converter(source, decorators.threads);
  converter.diagnostics.push(...decorators.diagnostics);
  for (const error of result.errors) {
    if (error.severity !== "Error") continue;
    const label = error.labels[0];
    const span: Span = label ? { start: label.start, end: label.end } : { start: 0, end: 0 };
    converter.diagnostics.push(diagnostic("LUCENT1000", span, error.message, error.helpMessage ?? undefined));
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

export function lucentImports(source: string, fileName: string): string[] {
  return parseModule(source, fileName)
    .module.imports.filter((i) => i.source.startsWith("."))
    .map((i) => i.source);
}
