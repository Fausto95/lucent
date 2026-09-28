/**
 * Where a component's React children go: the view one call of lucent:ui's
 * `slot` gives its setup, kept in a `const` at the top level of setup
 * (`const content = slot<UIView>()`). The host makes that view for each
 * mount and mounts the children React Native gives it there; setup puts it
 * in the view it returns.
 */
import ts from "typescript";
import type { Located } from "./describe.ts";
import { enclosingFunction, within } from "./expose.ts";
import type { FunctionLike } from "./roots.ts";

export interface SetupSlot {
  /** The call making the slot, if the setup makes one as it may. */
  readonly call?: ts.CallExpression;
  readonly problems: Located[];
}

/** The slot component `name`'s setup `fn` makes, among `calls` (every slot call). */
export function setupSlot(
  name: string,
  fn: FunctionLike,
  calls: readonly ts.CallExpression[],
  example: string,
): SetupSlot {
  const problems: Located[] = [];
  const top: ts.CallExpression[] = [];

  for (const call of calls) {
    if (!within(call, fn)) continue;

    if (enclosingFunction(call) !== fn)
      problems.push({
        message: `\`${name}\` calls slot in a nested function: a component makes its slot once, while it sets up`,
        node: call,
      });
    else if (!declaredAtTop(call, fn))
      problems.push({
        message: `\`${name}\` calls slot outside a declaration: keep its view, \`const content = ${example}\`, at the top level of its setup`,
        node: call,
      });
    else top.push(call);
  }

  if (top.length > 1) {
    problems.push({
      message: `\`${name}\` calls slot more than once: a component has one slot for its children`,
      node: top[1]!,
    });

    return { problems };
  }

  return top[0] ? { call: top[0], problems } : { problems };
}

/** Whether `call` initializes a `const` of a statement at the top level of `fn`'s body. */
function declaredAtTop(call: ts.CallExpression, fn: FunctionLike): boolean {
  const declaration = call.parent;
  const list = declaration.parent;
  const statement = list?.parent;

  return (
    ts.isVariableDeclaration(declaration) &&
    declaration.initializer === call &&
    ts.isVariableDeclarationList(list) &&
    !!(list.flags & ts.NodeFlags.Const) &&
    !!statement &&
    ts.isVariableStatement(statement) &&
    statement.parent === fn.body
  );
}
