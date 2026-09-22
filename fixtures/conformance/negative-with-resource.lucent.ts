import { NativeResource, withResource } from "@lucent-lang/core/resources";

/** Use after withResource closes the resource. */
export async function bad(): Promise<void> {
  const resource = new NativeResource();
  await withResource(resource, (r: NativeResource): void => {});
  resource.beginOperation();
}
