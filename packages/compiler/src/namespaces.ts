/** Namespace imports of Lucent modules (`import * as shapes from "./shapes.lucent"`). */
import ts from "typescript";

/**
 * The member's name when `e` reads a module's export through a namespace
 * import (`shapes.toPoint`): code treats it as that export, named by
 * the identifier TypeScript resolves to it.
 */
export function namespaceMember(
  checker: ts.TypeChecker,
  e: ts.Expression,
): ts.Identifier | undefined {
  if (!ts.isPropertyAccessExpression(e) || !ts.isIdentifier(e.expression)) return undefined;
  if (!ts.isIdentifier(e.name)) return undefined;

  const declaration = checker.getSymbolAtLocation(e.expression)?.declarations?.[0];

  return declaration && ts.isNamespaceImport(declaration) ? e.name : undefined;
}
