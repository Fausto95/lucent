import { cpp } from "@lucent-lang/codegen";
import type ts from "typescript";
import { sourcePath } from "../lowering/source.ts";

/**
 * Where code is, for traces: its name, its .lucent.ts file as `#line`
 * names it, and its line (`LUCENT_TRACE_SITE_AT`, a static): an export's
 * declaration, an effect's code.
 */
export function traceSite(name: string, node: ts.Node): cpp.Expr {
  const sf = node.getSourceFile();
  const line = sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1;

  return cpp.call("LUCENT_TRACE_SITE_AT", [
    cpp.str(name),
    cpp.str(sourcePath(sf.fileName)),
    cpp.num(line),
  ]);
}
