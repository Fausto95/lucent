import ts from "typescript";

/** Where the app's editor and tsc find lucent:* modules: the declarations `lucent build` writes. */
const ENTRY = '"lucent:*": ["./.lucent/native/types/*"]';

/**
 * tsconfig.json text with `"lucent:*"` in compilerOptions.paths, or
 * undefined when it maps lucent:* already. The text is JSONC, so the entry
 * is spliced in: comments, formatting and trailing commas stay as they are.
 */
export function withLucentPaths(text: string): string | undefined {
  const { error } = ts.parseConfigFileTextToJson("tsconfig.json", text);
  if (error) throw new Error(`tsconfig.json: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`);
  const sf = ts.parseJsonText("tsconfig.json", text);
  const root = sf.statements[0]?.expression;
  if (!root || !ts.isObjectLiteralExpression(root)) throw new Error("tsconfig.json: expected an object");
  const options = property(root, "compilerOptions");
  if (!options) return insert(text, sf, root, `"compilerOptions": { "paths": { ${ENTRY} } }`);
  const paths = property(options, "paths");
  if (!paths) return insert(text, sf, options, `"paths": { ${ENTRY} }`);
  if (named(paths, "lucent:*")) return undefined;
  return insert(text, sf, paths, ENTRY);
}

/**
 * tsconfig.json as Lucent needs it for editors and tsc: lucent:* mapped,
 * and noUncheckedIndexedAccess (the compiler always checks with it). Undefined
 * when it has both.
 */
export function withLucentTsconfig(text: string): string | undefined {
  const indexed = withCompilerOption(text, "noUncheckedIndexedAccess", "true");
  const paths = withLucentPaths(indexed ?? text);
  return paths ?? indexed;
}

/** tsconfig.json with compilerOptions.<name> set to `value` (JSON text), or undefined when it is. */
function withCompilerOption(text: string, name: string, value: string): string | undefined {
  const { error } = ts.parseConfigFileTextToJson("tsconfig.json", text);
  if (error) throw new Error(`tsconfig.json: ${ts.flattenDiagnosticMessageText(error.messageText, "\n")}`);
  const sf = ts.parseJsonText("tsconfig.json", text);
  const root = sf.statements[0]?.expression;
  if (!root || !ts.isObjectLiteralExpression(root)) throw new Error("tsconfig.json: expected an object");
  const options = property(root, "compilerOptions");
  if (!options) return insert(text, sf, root, `"compilerOptions": { "${name}": ${value} }`);
  const current = named(options, name);
  if (!current) return insert(text, sf, options, `"${name}": ${value}`);
  if (current.initializer.getText(sf) === value) return undefined;
  return `${text.slice(0, current.initializer.getStart(sf))}${value}${text.slice(current.initializer.getEnd())}`;
}

function named(o: ts.ObjectLiteralExpression, name: string): ts.PropertyAssignment | undefined {
  return o.properties.find((p): p is ts.PropertyAssignment => ts.isPropertyAssignment(p) && ts.isStringLiteral(p.name) && p.name.text === name);
}

function property(o: ts.ObjectLiteralExpression, name: string): ts.ObjectLiteralExpression | undefined {
  const value = named(o, name)?.initializer;
  if (value === undefined) return undefined;
  if (!ts.isObjectLiteralExpression(value)) throw new Error(`tsconfig.json: "${name}" should be an object`);
  return value;
}

/** `member` added as the last member of `o`, in the object's own layout. */
function insert(text: string, sf: ts.JsonSourceFile, o: ts.ObjectLiteralExpression, member: string): string {
  const open = o.getStart(sf);
  const last = o.properties.at(-1);
  if (!last) return `${text.slice(0, open)}{ ${member} }${text.slice(o.getEnd())}`;
  const line = (pos: number) => sf.getLineAndCharacterOfPosition(pos).line;
  if (line(last.getStart(sf)) === line(open)) return `${text.slice(0, last.getEnd())}, ${member}${text.slice(last.getEnd())}`;
  const lineStart = sf.getPositionOfLineAndCharacter(line(last.getStart(sf)), 0);
  const indent = text.slice(lineStart, last.getStart(sf));
  // A trailing comma after the last member: keep the style.
  const comma = /^\s*,/.exec(text.slice(last.getEnd()));
  if (comma) {
    const at = last.getEnd() + comma[0].length;
    return `${text.slice(0, at)}\n${indent}${member},${text.slice(at)}`;
  }
  return `${text.slice(0, last.getEnd())},\n${indent}${member}${text.slice(last.getEnd())}`;
}
