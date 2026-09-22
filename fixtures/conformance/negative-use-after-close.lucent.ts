import { borrow } from "@lucent-lang/sdk/buf";

/** Use of a binding after `close` (semantics § exit negative #7). */
@MainThread
export async function stop(): Promise<number> {
  const buffer = borrow();
  buffer.close();
  return buffer.length;
}
