/**
 * What lucent:compose's declarations stand for in Kotlin: the bindings
 * compose-dts.ts made them from, each a member of Compose's schemas with
 * the facts the content writer needs (composable or not, showing UI or
 * not, each parameter's name, position, kind, default and Kotlin type),
 * and how its Kotlin is written. lucent:compose's own declarations
 * (`compose`, the content types) have none.
 */
import ts from "typescript";
import { builtinSdkModuleOf } from "../program.ts";
import type { SdkParam, SdkType } from "../sdk/schema.ts";
import {
  bindingKey,
  type ComposeBinding,
  composeDeclarations,
  type DeclarationKind,
  givesElementsIn,
  listScopes,
} from "./compose-dts.ts";
import { composeModule } from "./compose-schemas.ts";

/** How Kotlin holds a number: JavaScript's are Doubles. */
export type NumberKind = "Double" | "Float" | "Int" | "Long" | "Short" | "Byte";

const KINDS: Partial<Record<string, NumberKind>> = {
  double: "Double",
  float: "Float",
  int: "Int",
  long: "Long",
  short: "Short",
  byte: "Byte",
};

/** Kotlin's number types lucent:compose brands. */
const BRANDED = ["Float", "Int", "Long", "Short", "Byte"] as const;

/** Whether a declaration is lucent:compose's. */
export function isComposeDeclaration(decl: ts.Node | undefined): boolean {
  return !!decl && builtinSdkModuleOf(decl.getSourceFile()) === "lucent:compose";
}

/** The binding of a declaration of lucent:compose; none for its own, and for any other. */
export function bindingOf(decl: ts.Node | undefined): ComposeBinding | undefined {
  if (!decl || !isComposeDeclaration(decl)) return undefined;

  const at = keyOf(decl);
  return at && composeDeclarations().bindings.get(at.key)?.[at.index];
}

/**
 * A declaration's binding key, and its index among the declarations of
 * that key: functions and constants of the module or of a namespace,
 * members of an interface, in the order compose-dts.ts printed them.
 */
function keyOf(decl: ts.Node): { key: string; index: number } | undefined {
  const at = (
    container: string,
    kind: DeclarationKind,
    name: string,
    siblings: readonly ts.Node[],
    self: ts.Node,
    same: (n: ts.Node) => boolean,
  ) => ({ key: bindingKey(container, kind, name), index: siblings.filter(same).indexOf(self) });

  if (ts.isFunctionDeclaration(decl) && decl.name) {
    const name = decl.name.text;
    const same = (n: ts.Node) => ts.isFunctionDeclaration(n) && n.name?.text === name;

    return at(namespacePath(decl), "function", name, statementsOf(decl.parent), decl, same);
  }

  if (ts.isVariableDeclaration(decl) && ts.isIdentifier(decl.name)) {
    const statement = decl.parent.parent;
    const name = decl.name.text;
    const same = (n: ts.Node) =>
      ts.isVariableStatement(n) &&
      n.declarationList.declarations.some((d) => ts.isIdentifier(d.name) && d.name.text === name);

    return at(
      namespacePath(statement),
      "const",
      name,
      statementsOf(statement.parent),
      statement,
      same,
    );
  }

  if (
    (ts.isMethodSignature(decl) || ts.isPropertySignature(decl)) &&
    ts.isInterfaceDeclaration(decl.parent)
  ) {
    const iface = decl.parent;
    const name = decl.name.getText();
    const container = [namespacePath(iface), iface.name.text].filter(Boolean).join(".");
    const same = (n: ts.Node) =>
      n.kind === decl.kind && (n as ts.TypeElement).name?.getText() === name;

    return at(
      container,
      ts.isMethodSignature(decl) ? "method" : "property",
      name,
      iface.members,
      decl,
      same,
    );
  }

  return undefined;
}

function statementsOf(parent: ts.Node): readonly ts.Node[] {
  return ts.isSourceFile(parent) || ts.isModuleBlock(parent) ? parent.statements : [];
}

/** The namespaces a declaration is in, outermost first: `Alignment` for `Alignment.Center`. */
function namespacePath(node: ts.Node): string {
  const names: string[] = [];

  for (let p = node.parent; p && !ts.isSourceFile(p); p = p.parent)
    if (ts.isModuleDeclaration(p) && ts.isIdentifier(p.name)) names.unshift(p.name.text);

  return names.join(".");
}

/** The Kotlin number type of a schema type, if it is a number. */
export function schemaNumberKind(t: SdkType): NumberKind | undefined {
  return t.k === "prim" && !t.nullable ? KINDS[t.name] : undefined;
}

/**
 * The Kotlin number type a TypeScript type stands for: lucent:compose's
 * branded numbers are Kotlin's (`Float`, through generics too:
 * `State<Float>`'s `value`), any other number a Double; undefined for
 * types that are not numbers.
 */
export function numberKindOf(
  checker: ts.TypeChecker,
  type: ts.Type | undefined,
): NumberKind | undefined {
  if (!type) return undefined;

  for (const kind of BRANDED)
    if (checker.getPropertyOfType(type, `lucent:compose.${kind}`)) return kind;

  return type.flags & ts.TypeFlags.NumberLike ? "Double" : undefined;
}

/**
 * Whether a lambda parameter's receiver is a scope (RowScope,
 * LazyListScope): the lambda's first parameter, which Kotlin's receiver
 * is (compose-dts.ts declares it so).
 */
export function receivesScope(param: SdkParam): boolean {
  const r = param.kotlin?.receiver;
  if (r?.k !== "ref" || param.kotlin?.returnsThrough) return false;

  const cls = composeModule(r.module)?.types.find((t) => t.name === r.name);

  return cls?.kind === "class" && !!cls.kotlin?.scope;
}

/**
 * Whether a callback parameter is a lambda of a list's scope
 * (LazyColumn's content, a LazyListScope's): it adds the elements its
 * function returns (`{(list) => <list.items …/>}`).
 */
export function givesElements(param: SdkParam): boolean {
  return givesElementsIn(listScopes(), param);
}
