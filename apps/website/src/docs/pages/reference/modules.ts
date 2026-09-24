import type { Block } from "../../types";
import { lucentModules } from "../../../generated/modules";

/** What each module is for; its declarations are generated from the file the compiler serves. */
const intros: Record<string, string> = {
  "lucent:core": "Helpers for any module: delays, errors with codes, UTF-8, a monotonic clock. Its JavaScript version, `@lucent-lang/lucent/core`, lets tests run modules as TypeScript ([Test a module](/docs/guides/test-a-module/)).",
  "lucent:platform": "Which platform the code runs on, for platform branches.",
  "lucent:thread": "The main thread, for platform code.",
  "lucent:ios": "iOS helpers for platform code. The SDK itself is `lucent:ios/<Framework>`.",
  "lucent:android": "Android helpers for platform code. The SDK itself is `lucent:android/<package>`.",
};

export const blocks: Block[] = lucentModules.flatMap(({ name, declarations }): Block[] => {
  const intro = intros[name];
  if (!intro) throw new Error(`${name} has no introduction on /docs/reference/modules/`);
  return [
    { kind: "h2", text: name },
    { kind: "p", text: intro },
    { kind: "code", filename: `${name.slice("lucent:".length)}.d.ts`, code: declarations },
  ];
});
