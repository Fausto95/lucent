import { Buffer, take } from "@lucent-lang/sdk/buf";

/** Explicit move of an owned local (Gate A P44–P45). */
export function handoff(): void {
  const owned = new Buffer();
  take(move(owned));
}
