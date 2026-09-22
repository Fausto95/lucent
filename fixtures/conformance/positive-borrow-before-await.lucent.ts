import { borrow } from "@lucent-lang/sdk/buf";

async function pause(): Promise<number> {
  return 1;
}

/** Borrow used before suspension is accepted (semantics § borrowed / suspension). */
@MainThread
export async function read(): Promise<number> {
  const buffer = borrow();
  const length = buffer.length;
  await pause();
  return length;
}
