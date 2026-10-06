/**
 * Where a component's React children go: the view one call of lucent:ui's
 * `slot` gives its setup, kept in a `const` at the top level of setup
 * (`const content = slot<UIView>()`). The host makes that view for each
 * mount and mounts the children React Native gives it there; setup puts it
 * in the view it returns.
 */
import ts from "typescript";
import { branchPlatform, topLevel } from "../platforms.ts";
import type { Platform } from "../sdk/schema.ts";
import type { Located } from "./describe.ts";
import { enclosingFunction, within } from "./expose.ts";
import type { FunctionLike } from "./roots.ts";

export interface SetupSlot {
  /** The call making the slot, if the setup makes one as it may. */
  readonly call?: ts.CallExpression;
  readonly problems: Located[];
}

/**
 * The slot component `name`'s setup `fn` makes on `platform`, among
 * `calls` (every slot call): another platform's branches are not its code.
 * The host's program, of no platform, has every platform's, one slot each.
 */
export function setupSlot(
  name: string,
  fn: FunctionLike,
  calls: readonly ts.CallExpression[],
  example: string,
  checker: ts.TypeChecker,
  platform: Platform | undefined,
): SetupSlot {
  const problems: Located[] = [];
  const top: { call: ts.CallExpression; branch: Platform | undefined }[] = [];

  for (const call of calls) {
    const branch = branchPlatform(checker, call);

    if (!within(call, fn) || (platform && branch && branch !== platform)) continue;

    if (enclosingFunction(call) !== fn)
      problems.push({
        message: `\`${name}\` calls slot in a nested function: a component makes its slot once, while it sets up`,
        node: call,
      });
    else if (!declaredAtTop(checker, call, fn))
      problems.push({
        message: `\`${name}\` calls slot outside a declaration: keep its view, \`const content = ${example}\`, at the top level of its setup, or of a PLATFORM branch`,
        node: call,
      });
    else top.push({ call, branch });
  }

  // Two slots one platform runs both of: code of no branch runs on every platform.
  const again = top.find((s, i) =>
    top.slice(0, i).some((t) => !s.branch || !t.branch || s.branch === t.branch),
  );

  if (again) {
    problems.push({
      message: `\`${name}\` calls slot more than once: a component has one slot for its children`,
      node: again.call,
    });

    return { problems };
  }

  return top[0] ? { call: top[0].call, problems } : { problems };
}

/**
 * Whether `call` initializes a `const` of a statement in `fn`'s own code:
 * its body, or its PLATFORM branches.
 */
function declaredAtTop(
  checker: ts.TypeChecker,
  call: ts.CallExpression,
  fn: FunctionLike,
): boolean {
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
    topLevel(checker, statement, fn)
  );
}
