/**
 * C facts that depend on the host the headers are read on, as the clang
 * that reads them states them.
 */
import { spawnSync } from "node:child_process";
import { findClang } from "../src/c-header.ts";

/** clang's spellings of the 64-bit types, by the names C writes them with. */
const SPELLINGS: Record<string, string> = {
  "long unsigned int": "unsigned long",
  "long long unsigned int": "unsigned long long",
  "long int": "long",
  "long long int": "long long",
};

/** The C type a predefined macro (`__UINT64_TYPE__`) names, as C writes it. */
function macroType(macro: string): string {
  const macros = spawnSync(findClang(), ["-dM", "-E", "-x", "c", "/dev/null"], {
    encoding: "utf8",
  }).stdout;
  const spelled = new RegExp(`^#define ${macro} (.+)$`, "m").exec(macros)?.[1]?.trim() ?? "";
  const name = SPELLINGS[spelled];

  if (!name) throw new Error(`clang's ${macro} is "${spelled}"`);

  return name;
}

/**
 * The C type `uint64_t` names: `unsigned long long` on Darwin, `unsigned
 * long` on Linux. Both are 64 bits wide, so both are bigints to Lucent.
 */
export function uint64Name(): string {
  return macroType("__UINT64_TYPE__");
}

/** The C type `int64_t` names: `long long` on Darwin, `long` on Linux. */
export function int64Name(): string {
  return macroType("__INT64_TYPE__");
}
