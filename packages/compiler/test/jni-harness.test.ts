/**
 * The JNI harness's output: what the program printed, without what the JVM
 * prints of itself.
 */
import { describe, expect, it } from "vite-plus/test";
import { withoutSignalWarnings } from "./jni-harness.ts";

describe("withoutSignalWarnings", () => {
  it("drops -Xcheck:jni's warning and the table of handlers after it", () => {
    const printed = [
      "Warning: SIGUSR2 handler modified!",
      "Signal Handlers:",
      "   SIGSEGV: [libjvm.dylib+0x1], sa_mask[0]=11111111011111111101111111111110, sa_flags=SA_ONSTACK|SA_RESTART|SA_SIGINFO",
      "   SIGUSR2: [libjvm.dylib+0x2], sa_mask[0]=00000000000000000000000000000000, sa_flags=SA_RESTART|SA_SIGINFO",
      "  *** Handler was modified!",
      "",
      "true RangeError out of range",
      "",
    ].join("\n");

    expect(withoutSignalWarnings(printed)).toBe("true RangeError out of range\n");
    expect(withoutSignalWarnings(`true\n${printed}`)).toBe("true\ntrue RangeError out of range\n");
    expect(withoutSignalWarnings("Warning: SIGINT handler modified!\nok\n")).toBe("ok\n");
  });

  it("keeps the program's own lines", () => {
    expect(withoutSignalWarnings("Warning: low disk\n  indented\n")).toBe(
      "Warning: low disk\n  indented\n",
    );
  });
});
