import { buildCommand } from "./build.ts";
import { checkCommand } from "./check.ts";
import { cleanCommand } from "./clean.ts";
import { doctorCommand } from "./doctor.ts";
import { explainCommand } from "./explain.ts";
import { initCommand } from "./init.ts";
import { irCommand } from "./ir.ts";
import { sdkCommand } from "./sdk.ts";
import type { Command } from "./types.ts";

/** Order is the order shown in `lucent --help`. */
export const COMMANDS: readonly Command[] = [
  buildCommand,
  checkCommand,
  initCommand,
  doctorCommand,
  explainCommand,
  irCommand,
  cleanCommand,
  sdkCommand,
];

export const findCommand = (name: string): Command | undefined => COMMANDS.find((c) => c.name === name);
