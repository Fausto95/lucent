import { TaskScope } from "@lucent-lang/core/tasks";

/** Transferable owned reference accepted as an async argument (semantics § exit #3). */
export async function settle(scope: TaskScope): Promise<number> {
  const before = scope.activeCount;
  await scope.close();
  return before;
}
