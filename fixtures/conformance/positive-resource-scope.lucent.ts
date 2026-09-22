import { NativeResource, resourceScope } from "@lucent-lang/core/resources";

/** Multi-resource reverse-order close via resourceScope (Gate A P42–P43). */
export async function use(): Promise<void> {
  const first = new NativeResource();
  const second = new NativeResource();
  await resourceScope((scope): void => {
    scope.own(first);
    scope.own(second);
    first.beginOperation();
    first.endOperation();
  });
}
