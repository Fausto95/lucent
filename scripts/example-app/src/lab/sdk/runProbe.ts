import type { SdkCase } from "./types";

export interface ProbeResult {
  name: string;
  pass: boolean;
  got: string;
  expected: string;
  ms: number;
}

/** Runs one platform probe and matches its answer against what this platform should say. */
export async function runProbe(c: SdkCase): Promise<ProbeResult> {
  const start = Date.now();

  let got: string;
  try {
    got = await c.run();
  } catch (e) {
    got = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
  }

  const pass = typeof c.expected === "string" ? got === c.expected : c.expected.test(got);

  return { name: c.name, pass, got, expected: String(c.expected), ms: Date.now() - start };
}
