/**
 * The program's own names, kept out of reach of the preprocessor.
 *
 * The C library and the platform SDKs define macros under ordinary names
 * (HUGE and DOMAIN in <math.h>, pascal and MIN on Apple platforms,
 * si_value in Android's <signal.h>), and which ones depends on the
 * platform and its version: no list of them is complete. So each
 * generated file undefines, after its includes, the names the program
 * declares that it spells, and restores them at its end. Names the glue
 * takes from an SDK keep their macros.
 */
import { cpp } from "@lucent-lang/codegen";
import ts from "typescript";
import { cppIdent } from "../types.ts";

/** Declarations whose name the program chooses, in the C++ as cppIdent spells it. */
const NAMED: ((n: ts.Node) => boolean)[] = [
  ts.isVariableDeclaration,
  ts.isParameter,
  ts.isBindingElement,
  ts.isFunctionDeclaration,
  ts.isFunctionExpression,
  ts.isClassDeclaration,
  ts.isClassExpression,
  ts.isInterfaceDeclaration,
  ts.isTypeAliasDeclaration,
  ts.isTypeParameterDeclaration,
  ts.isEnumDeclaration,
  ts.isEnumMember,
  ts.isPropertyDeclaration,
  ts.isPropertySignature,
  ts.isMethodDeclaration,
  ts.isMethodSignature,
  ts.isGetAccessorDeclaration,
  ts.isSetAccessorDeclaration,
  ts.isPropertyAssignment,
  ts.isShorthandPropertyAssignment,
];

/** The C++ spelling of every name the program's modules declare. */
export function declaredNames(files: readonly ts.SourceFile[]): Set<string> {
  const names = new Set<string>();

  const visit = (node: ts.Node): void => {
    const name = (node as ts.NamedDeclaration).name;

    if (
      name &&
      (ts.isIdentifier(name) || ts.isStringLiteral(name) || ts.isNumericLiteral(name)) &&
      NAMED.some((is) => is(node))
    )
      names.add(cppIdent(name.text));

    ts.forEachChild(node, visit);
  };

  for (const file of files) visit(file);

  return names;
}

/**
 * C++ tokens the preprocessor does not expand (comments, string and
 * character literals, numbers), or an identifier, captured. A #line
 * directive's file is a string: the sources' path must not decide
 * which names are guarded.
 */
const TOKEN =
  /\/\/[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|\.?\d(?:[eEpP][+-]|[\w.])*|([A-Za-z_]\w*)/g;

/** The identifiers `code` spells where a macro would expand. */
function identifiers(code: string): Set<string> {
  return new Set([...code.matchAll(TOKEN)].flatMap((m) => (m[1] ? [m[1]] : [])));
}

/** `decls` with the declared names they spell undefined as macros, when they spell any. */
export function withoutMacros(decls: cpp.Decl[], declared: ReadonlySet<string>): cpp.Decl[] {
  const spelled = identifiers(cpp.printDecls(decls));
  const names = [...declared].filter((n) => spelled.has(n)).sort();

  return names.length ? [cpp.withoutMacros(names, decls)] : decls;
}
