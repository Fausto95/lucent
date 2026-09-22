import { borrow } from "@lucent-lang/sdk/buf";

async function pause(): Promise<number> {
  return 1;
}

/** Borrow used after `await` (semantics § exit negative #2). */
@MainThread
export async function later(): Promise<number> {
  const buffer = borrow();
  await pause();
  return buffer.length;
}
