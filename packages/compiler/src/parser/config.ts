import { parseSync } from "oxc-parser";
import type * as ES from "@oxc-project/types";
/** Read literal build configuration without evaluating application JavaScript. */
export function parseNativeConfig(source: string, fileName = "lucent.config.ts"): unknown {
  const parsed = parseSync(fileName, source);
  if (parsed.errors.length) throw new Error(`${fileName}: invalid configuration syntax`);
  let exported: ES.Expression | undefined;
  const literal = (node: ES.Expression): unknown => {
    if (node.type === "TSAsExpression" || node.type === "TSSatisfiesExpression") return literal(node.expression);
    if (node.type === "Literal" && !("regex" in node) && !("bigint" in node)) return node.value;
    if (node.type === "ArrayExpression")
      return node.elements.map((item) => {
        if (!item || item.type === "SpreadElement")
          throw new Error(`${fileName}: array spreads and holes are unsupported`);
        return literal(item);
      });
    if (node.type === "ObjectExpression") {
      const value: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
      for (const prop of node.properties) {
        if (prop.type !== "Property" || prop.computed || prop.method || prop.kind !== "init")
          throw new Error(`${fileName}: expected literal properties`);
        const key =
          prop.key.type === "Identifier"
            ? prop.key.name
            : prop.key.type === "Literal" && typeof prop.key.value === "string"
              ? prop.key.value
              : undefined;
        if (key === undefined || Object.hasOwn(value, key))
          throw new Error(`${fileName}: invalid or duplicate property`);
        value[key] = literal(prop.value);
      }
      return value;
    }
    throw new Error(`${fileName}: configuration must contain literal values; expressions are not executed`);
  };
  for (const node of parsed.program.body) {
    if (
      node.type === "ImportDeclaration" &&
      node.source.value === "@lucent-lang/config" &&
      node.specifiers.every(
        (s) =>
          s.type === "ImportSpecifier" &&
          s.imported.type === "Identifier" &&
          s.imported.name === "defineNativeConfig" &&
          s.local.name === "defineNativeConfig",
      )
    )
      continue;
    if (node.type !== "ExportDefaultDeclaration" || exported)
      throw new Error(`${fileName}: expected one default configuration export`);
    const declaration = node.declaration;
    if (
      declaration.type === "FunctionDeclaration" ||
      declaration.type === "ClassDeclaration" ||
      declaration.type === "TSInterfaceDeclaration"
    )
      throw new Error(`${fileName}: expected a literal configuration`);
    exported = declaration;
  }
  if (!exported) throw new Error(`${fileName}: missing default export`);
  if (
    exported.type === "CallExpression" &&
    exported.callee.type === "Identifier" &&
    exported.callee.name === "defineNativeConfig" &&
    exported.arguments.length === 1 &&
    exported.arguments[0]?.type !== "SpreadElement"
  )
    exported = exported.arguments[0]!;
  return literal(exported);
}
