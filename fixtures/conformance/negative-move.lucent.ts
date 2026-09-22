import { Buffer, take } from "@lucent-lang/sdk/buf";

/** Use after move (Gate A P44). */
export function handoff(): number {
  const owned = new Buffer();
  take(move(owned));
  return owned.length;
}
