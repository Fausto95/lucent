import { NativeResource, withResource } from "@lucent-lang/core/resources";

/** Scoped close via withResource (Gate A P42–P43). */
export async function use(): Promise<void> {
  const resource = new NativeResource();
  await withResource(resource, (r: NativeResource): void => {
    r.beginOperation();
    r.endOperation();
  });
}
