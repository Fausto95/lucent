/**
 * C facts that depend on the host the headers are read on, as the clang
 * that reads them states them.
 */
import { spawnSync } from "node:child_process";
import { findClang } from "../src/c-header.ts";

/** clang's spellings of the 64-bit unsigned types, by the names C writes them with. */
const SPELLINGS: Record<string, string> = {
  "long unsigned int": "unsigned long",
  "long long unsigned int": "unsigned long long",
};

/**
 * The C type `uint64_t` names: `unsigned long long` on Darwin, `unsigned
 * long` on Linux. Both are 64 bits wide, so both are bigints to Lucent.
 */
export function uint64Name(): string {
  const macros = spawnSync(findClang(), ["-dM", "-E", "-x", "c", "/dev/null"], {
    encoding: "utf8",
  }).stdout;
  const spelled = /^#define __UINT64_TYPE__ (.+)$/m.exec(macros)?.[1]?.trim() ?? "";
  const name = SPELLINGS[spelled];

  if (!name) throw new Error(`clang names uint64_t "${spelled}"`);

  return name;
}
