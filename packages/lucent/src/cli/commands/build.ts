import type { Invocation } from "../args.ts";
import { buildOrCheck } from "./build-check.ts";

export function run(invocation: Invocation): number {
  return buildOrCheck("build", invocation);
}
