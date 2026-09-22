import { TaskScope } from "@lucent-lang/core/tasks";

export function open(): TaskScope {
  return new TaskScope();
}

export async function settle(scope: TaskScope): Promise<number> {
  const before = scope.activeCount;
  await scope.close();
  return before;
}
